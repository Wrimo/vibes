package dev.vibes.brick

import android.app.Activity
import android.content.ComponentName
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.nfc.NfcAdapter
import android.provider.Settings
import android.view.View
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowAlertDialog
import java.io.File

/** Runs the real activities and service against a simulated Android. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w411dp-h891dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppTest {

    private val app get() = RuntimeEnvironment.getApplication()
    private val tag = byteArrayOf(0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66)
    private val store get() = PrefsStore(app)

    @Before
    fun nfcOn() {
        shadowOf(app.packageManager).setSystemFeature("android.hardware.nfc", true)
        shadowOf(NfcAdapter.getDefaultAdapter(app)).setEnabled(true)
    }

    private fun enableBlocker() {
        Settings.Secure.putString(
            app.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            "com.other/.Service:" + ComponentName(app, BlockerService::class.java).flattenToString(),
        )
    }

    private fun brickedWith(vararg apps: String) {
        store.pairedTagId = "04112233445566"
        store.blockedPackages = apps.toSet()
        store.bricked = true
        store.brickedSince = System.currentTimeMillis() - 95 * 60_000
    }

    private fun windowOpened(pkg: String, cls: String = "$pkg.Main") =
        AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply {
            packageName = pkg
            className = cls
        }

    private fun Activity.text(id: Int) = findViewById<TextView>(id).text.toString()

    private fun snapshot(activity: Activity, name: String) {
        val dir = System.getProperty("brick.snapshots") ?: return
        val view = activity.window.decorView
        // Nothing lays views out again here after their text changes, so do it by hand.
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        view.measure(
            View.MeasureSpec.makeMeasureSpec(view.width, View.MeasureSpec.EXACTLY),
            View.MeasureSpec.makeMeasureSpec(view.height, View.MeasureSpec.EXACTLY),
        )
        view.layout(0, 0, view.width, view.height)
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bitmap))
        File(dir).mkdirs()
        File(dir, "$name.png").outputStream().use {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }

    @Test
    fun freshInstallWalksThroughSetupThenBricks() {
        val main = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        assertEquals("Unbricked", main.text(R.id.statusTitle))
        assertTrue(main.text(R.id.setupText).contains("pair"))
        snapshot(main, "1-first-run")

        main.onScan(tag)
        assertEquals("04112233445566", store.pairedTagId)
        assertTrue(main.text(R.id.setupText).contains("Choose the apps"))

        store.blockedPackages = setOf("com.instagram.android")
        store.lastChangeAt = 0
        main.onScan(tag)
        assertFalse("must not brick while the blocker is off", store.bricked)
        assertTrue(main.text(R.id.setupText).contains("Accessibility"))
        snapshot(main, "2-needs-accessibility")

        enableBlocker()
        main.onScan(tag)
        assertTrue(store.bricked)
        assertEquals("Bricked", main.text(R.id.statusTitle))
        assertEquals(View.GONE, main.findViewById<View>(R.id.setupCard).visibility)
        assertFalse(main.findViewById<Button>(R.id.appsButton).isEnabled)
        assertFalse(main.findViewById<Button>(R.id.forgetButton).isEnabled)
        snapshot(main, "3-bricked")
    }

    @Test
    fun readyAndUnbrickedShowsNoSetupCard() {
        enableBlocker()
        store.pairedTagId = "04112233445566"
        store.blockedPackages = setOf("a", "b", "c")
        val main = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        assertEquals(View.GONE, main.findViewById<View>(R.id.setupCard).visibility)
        assertEquals("Apps to block (3)", main.text(R.id.appsButton))
        assertFalse("nothing to refill", main.findViewById<Button>(R.id.emergencyButton).isEnabled)
        snapshot(main, "4-ready")
    }

    @Test
    fun tappingTheTagFromTheHomeScreenTogglesOnce() {
        enableBlocker()
        store.pairedTagId = "04112233445566"
        store.blockedPackages = setOf("com.instagram.android")
        // Tag has no public constructor; this is the hidden factory Android's own tests use.
        val nfcTag = android.nfc.Tag::class.java.getDeclaredMethod(
            "createMockTag",
            ByteArray::class.java, IntArray::class.java,
            Array<android.os.Bundle>::class.java, Long::class.javaPrimitiveType,
        ).invoke(null, tag, intArrayOf(), arrayOf<android.os.Bundle>(), 0L) as android.nfc.Tag
        val launch = Intent(NfcAdapter.ACTION_TECH_DISCOVERED)
            .setClass(app, MainActivity::class.java)
            .putExtra(NfcAdapter.EXTRA_TAG, nfcTag)

        val controller = Robolectric.buildActivity(MainActivity::class.java, launch).setup()
        assertTrue(store.bricked)

        // Rotating the phone must not replay the tap and unbrick it.
        store.lastChangeAt = 0
        controller.recreate()
        assertTrue(store.bricked)
    }

    @Test
    fun emergencyUnlockFromMainScreenAsksFirst() {
        enableBlocker()
        brickedWith("com.instagram.android")
        val main = Robolectric.buildActivity(MainActivity::class.java).setup().get()
        main.findViewById<Button>(R.id.emergencyButton).performClick()
        assertTrue(store.bricked)
        ShadowAlertDialog.getLatestAlertDialog()
            .getButton(android.app.AlertDialog.BUTTON_POSITIVE).performClick()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        assertFalse(store.bricked)
        assertEquals(4, store.emergencyUnlocksLeft)
        assertEquals("Unbricked", main.text(R.id.statusTitle))
    }

    @Test
    fun serviceCoversABlockedAppAndLeavesOthersAlone() {
        brickedWith("com.instagram.android")
        val service = Robolectric.setupService(BlockerService::class.java)

        service.onAccessibilityEvent(windowOpened("com.google.android.apps.maps"))
        assertNull(shadowOf(service).nextStartedActivity)

        service.onAccessibilityEvent(windowOpened("com.instagram.android"))
        val started = shadowOf(service).nextStartedActivity
        assertEquals(BlockActivity::class.java.name, started.component?.className)
        assertTrue(started.flags and Intent.FLAG_ACTIVITY_NEW_TASK != 0)

        store.bricked = false
        service.onAccessibilityEvent(windowOpened("com.instagram.android"))
        assertNull(shadowOf(service).nextStartedActivity)
    }

    @Test
    fun serviceIgnoresEventsThatAreNotAnAppComingToTheFront() {
        brickedWith("com.instagram.android")
        val service = Robolectric.setupService(BlockerService::class.java)
        service.onAccessibilityEvent(
            AccessibilityEvent.obtain(AccessibilityEvent.TYPE_VIEW_CLICKED).apply {
                packageName = "com.instagram.android"
            }
        )
        service.onAccessibilityEvent(null)
        assertNull(shadowOf(service).nextStartedActivity)
    }

    @Test
    fun blockScreenUnlocksWithTheTagOnly() {
        enableBlocker()
        brickedWith("com.instagram.android")
        val block = Robolectric.buildActivity(
            BlockActivity::class.java, BlockActivity.intent(app, "com.instagram.android"),
        ).setup().get()
        assertEquals("Bricked for 1 h 35 min", block.text(R.id.duration))
        assertEquals("Emergency unlock (5 left)", block.text(R.id.emergencyButton))
        snapshot(block, "5-block-screen")

        val scan = BlockActivity::class.java.getDeclaredMethod("onScan", ByteArray::class.java)
            .apply { isAccessible = true }
        scan.invoke(block, byteArrayOf(0x04, 0x77, 0x22, 0x33, 0x44, 0x55, 0x66))
        assertTrue(store.bricked)
        assertFalse(block.isFinishing)
        assertEquals("That isn't your brick.", block.text(R.id.hint))

        scan.invoke(block, tag)
        assertFalse(store.bricked)
        assertTrue(block.isFinishing)
    }

    @Test
    fun blockScreenBackAndHomeButtonLeaveToTheHomeScreen() {
        brickedWith("com.instagram.android")
        val block = Robolectric.buildActivity(
            BlockActivity::class.java, BlockActivity.intent(app, "com.instagram.android"),
        ).setup().get()
        block.findViewById<Button>(R.id.homeButton).performClick()
        val started = shadowOf(block).nextStartedActivity
        assertEquals(Intent.ACTION_MAIN, started.action)
        assertTrue(started.hasCategory(Intent.CATEGORY_HOME))
        assertTrue(block.isFinishing)
        assertTrue(store.bricked)
    }

    @Test
    fun blockScreenClosesItselfIfNoLongerBricked() {
        val block = Robolectric.buildActivity(
            BlockActivity::class.java, BlockActivity.intent(app, "com.instagram.android"),
        ).setup().get()
        assertTrue(block.isFinishing)
    }

    @Test
    fun pickerSavesTicksAndIsShutWhileBricked() {
        val pm = shadowOf(app.packageManager)
        listOf("com.instagram.android" to "Instagram", "com.google.android.youtube" to "YouTube")
            .forEach { (pkg, label) ->
                val info = android.content.pm.ActivityInfo().apply {
                    packageName = pkg
                    name = "$pkg.Main"
                    applicationInfo = android.content.pm.ApplicationInfo().apply {
                        packageName = pkg
                        nonLocalizedLabel = label
                    }
                }
                pm.addResolveInfoForIntent(
                    Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),
                    android.content.pm.ResolveInfo().apply { activityInfo = info },
                )
            }

        val picker = Robolectric.buildActivity(AppPickerActivity::class.java).setup().get()
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        Thread.sleep(300)
        org.robolectric.shadows.ShadowLooper.idleMainLooper()
        val list = picker.findViewById<android.widget.ListView>(R.id.list)
        assertEquals(2, list.adapter.count)
        shadowOf(list).performItemClick(1)
        assertEquals(setOf("com.google.android.youtube"), store.blockedPackages)
        shadowOf(list).performItemClick(1)
        assertEquals(emptySet<String>(), store.blockedPackages)
        shadowOf(list).performItemClick(0)
        snapshot(picker, "6-picker")

        brickedWith("com.instagram.android")
        val shut = Robolectric.buildActivity(AppPickerActivity::class.java).setup().get()
        assertTrue(shut.isFinishing)
    }
}
