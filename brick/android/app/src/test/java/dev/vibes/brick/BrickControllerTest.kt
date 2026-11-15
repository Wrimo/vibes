package dev.vibes.brick

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrickControllerTest {

    private class MemoryStore : BrickStore {
        override var pairedTagId: String? = null
        override var bricked = false
        override var brickedSince = 0L
        override var lastChangeAt = 0L
        override var blockedPackages: Set<String> = emptySet()
        override var emergencyUnlocksLeft = BrickController.MAX_EMERGENCY_UNLOCKS
        override var strictMode = false
    }

    private val store = MemoryStore()
    private var clock = 1_000_000L
    private val brick = BrickController(store, "dev.vibes.brick") { clock }

    private val tag = byteArrayOf(0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66)
    private val otherTag = byteArrayOf(0x04, 0x77, 0x22, 0x33, 0x44, 0x55, 0x66)

    /** Scan after enough time that the repeat-read guard is out of the way. */
    private fun tap(uid: ByteArray = tag, blockerReady: Boolean = true): ScanResult {
        clock += 10_000
        return brick.onTagScanned(uid, blockerReady)
    }

    private fun pairAndPick(vararg apps: String = arrayOf("com.instagram.android")) {
        assertEquals(ScanResult.PAIRED, tap())
        assertTrue(brick.setBlockedPackages(apps.toSet()))
    }

    @Test
    fun firstTagBecomesTheBrick() {
        assertFalse(brick.isPaired)
        assertEquals(ScanResult.PAIRED, tap())
        assertEquals("04112233445566", store.pairedTagId)
        assertFalse(brick.isBricked)
    }

    @Test
    fun pairedTagTogglesTheBlock() {
        pairAndPick()
        assertEquals(ScanResult.BRICKED, tap())
        assertTrue(brick.isBricked)
        assertEquals(ScanResult.UNBRICKED, tap())
        assertFalse(brick.isBricked)
    }

    @Test
    fun anotherTagNeitherBricksNorUnbricks() {
        pairAndPick()
        assertEquals(ScanResult.WRONG_TAG, tap(otherTag))
        assertFalse(brick.isBricked)
        tap()
        assertEquals(ScanResult.WRONG_TAG, tap(otherTag))
        assertTrue(brick.isBricked)
    }

    @Test
    fun randomIdTagsAreRefusedSoTheyCannotLockYouOut() {
        assertEquals(ScanResult.UNUSABLE_TAG, tap(byteArrayOf(0x08, 0x12, 0x34, 0x56)))
        assertEquals(ScanResult.UNUSABLE_TAG, tap(byteArrayOf()))
        assertFalse(brick.isPaired)
    }

    @Test
    fun aPhoneRestingOnTheTagTogglesOnce() {
        pairAndPick()
        assertEquals(ScanResult.BRICKED, tap())
        clock += 500
        assertEquals(ScanResult.IGNORED, brick.onTagScanned(tag, true))
        assertTrue(brick.isBricked)
        clock += BrickController.DEBOUNCE_MS
        assertEquals(ScanResult.UNBRICKED, brick.onTagScanned(tag, true))
    }

    @Test
    fun aClockSetBackwardsDoesNotJamTheTag() {
        pairAndPick()
        tap()
        clock -= 3_600_000
        assertEquals(ScanResult.UNBRICKED, brick.onTagScanned(tag, true))
    }

    @Test
    fun willNotBrickWithNothingToBlock() {
        tap()
        assertEquals(ScanResult.NO_APPS, tap())
        assertFalse(brick.isBricked)
    }

    @Test
    fun willNotBrickWhileTheBlockerIsOffButCanStillUnbrick() {
        pairAndPick()
        assertEquals(ScanResult.BLOCKER_OFF, tap(blockerReady = false))
        assertFalse(brick.isBricked)
        tap()
        assertEquals(ScanResult.UNBRICKED, tap(blockerReady = false))
    }

    @Test
    fun blocksOnlyChosenAppsAndOnlyWhileBricked() {
        pairAndPick("com.instagram.android", "com.zhiliaoapp.musically")
        assertFalse(brick.shouldBlock("com.instagram.android"))
        tap()
        assertTrue(brick.shouldBlock("com.instagram.android"))
        assertTrue(brick.shouldBlock("com.zhiliaoapp.musically"))
        assertFalse(brick.shouldBlock("com.google.android.apps.maps"))
        assertFalse(brick.shouldBlock("com.android.settings"))
    }

    @Test
    fun neverBlocksItself() {
        tap()
        store.blockedPackages = setOf("dev.vibes.brick", "com.instagram.android")
        tap()
        assertTrue(brick.isBricked)
        assertFalse(brick.shouldBlock("dev.vibes.brick"))
        assertFalse(brick.setBlockedPackages(setOf("dev.vibes.brick")))
    }

    @Test
    fun strictModeAlsoBlocksSettingsAndUninstalling() {
        pairAndPick()
        assertTrue(brick.setStrictMode(true))
        assertFalse(brick.shouldBlock("com.android.settings"))
        tap()
        assertTrue(brick.shouldBlock("com.android.settings"))
        assertTrue(
            brick.shouldBlock(
                "com.google.android.packageinstaller",
                "com.android.packageinstaller.UninstallerActivity",
            )
        )
        // Installing and permission prompts stay usable.
        assertFalse(
            brick.shouldBlock(
                "com.google.android.packageinstaller",
                "com.android.packageinstaller.InstallStart",
            )
        )
        assertFalse(brick.shouldBlock("com.google.android.permissioncontroller"))
    }

    @Test
    fun settingsAreFrozenWhileBricked() {
        pairAndPick()
        tap()
        assertFalse(brick.setBlockedPackages(emptySet()))
        assertFalse(brick.setStrictMode(true))
        assertFalse(brick.forgetTag())
        assertFalse(brick.resetEmergencyUnlocks())
        assertEquals(setOf("com.instagram.android"), brick.blockedPackages)
        assertTrue(brick.isPaired)
    }

    @Test
    fun emergencyUnlockSpendsOneAndRunsOut() {
        pairAndPick()
        repeat(BrickController.MAX_EMERGENCY_UNLOCKS) { used ->
            assertEquals(ScanResult.BRICKED, tap())
            assertTrue(brick.emergencyUnlock())
            assertFalse(brick.isBricked)
            assertEquals(BrickController.MAX_EMERGENCY_UNLOCKS - used - 1, brick.emergencyUnlocksLeft)
        }
        tap()
        assertFalse(brick.emergencyUnlock())
        assertTrue(brick.isBricked)
        // The tag still works, and only then can the supply be refilled.
        assertEquals(ScanResult.UNBRICKED, tap())
        assertTrue(brick.resetEmergencyUnlocks())
        assertEquals(BrickController.MAX_EMERGENCY_UNLOCKS, brick.emergencyUnlocksLeft)
    }

    @Test
    fun emergencyUnlockDoesNothingWhenNotBricked() {
        pairAndPick()
        assertFalse(brick.emergencyUnlock())
        assertEquals(BrickController.MAX_EMERGENCY_UNLOCKS, brick.emergencyUnlocksLeft)
    }

    @Test
    fun forgettingTheTagLetsANewOnePair() {
        pairAndPick()
        assertTrue(brick.forgetTag())
        assertEquals(ScanResult.PAIRED, tap(otherTag))
        assertEquals(ScanResult.WRONG_TAG, tap(tag))
    }

    @Test
    fun tracksHowLongThePhoneHasBeenBricked() {
        pairAndPick()
        tap()
        clock += 90 * 60_000
        assertEquals(90 * 60_000L, brick.brickedFor())
        assertEquals("1 h 30 min", BrickController.formatDuration(brick.brickedFor()))
    }

    @Test
    fun formatsDurations() {
        assertEquals("less than a minute", BrickController.formatDuration(59_000))
        assertEquals("14 min", BrickController.formatDuration(14 * 60_000))
        assertEquals("2 h 0 min", BrickController.formatDuration(120 * 60_000))
        assertEquals("3 d 2 h", BrickController.formatDuration((3 * 24 + 2) * 3_600_000L))
    }
}
