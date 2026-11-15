package dev.vibes.brick

/** Everything the app remembers. SharedPreferences on a phone, a plain object in tests. */
interface BrickStore {
    var pairedTagId: String?
    var bricked: Boolean
    var brickedSince: Long
    var lastChangeAt: Long
    var blockedPackages: Set<String>
    var emergencyUnlocksLeft: Int
    var strictMode: Boolean
}

enum class ScanResult {
    PAIRED,
    BRICKED,
    UNBRICKED,
    WRONG_TAG,
    UNUSABLE_TAG,
    NO_APPS,
    BLOCKER_OFF,
    IGNORED,
}

/**
 * The rules of the brick, free of Android so they can be unit tested.
 *
 * The tag is recognised by its factory serial number (UID). Nothing is written
 * to it, so the same blank tag can be paired with any number of phones.
 */
class BrickController(
    private val store: BrickStore,
    private val ownPackage: String,
    private val now: () -> Long = System::currentTimeMillis,
) {
    val isPaired: Boolean get() = store.pairedTagId != null
    val isBricked: Boolean get() = store.bricked
    val brickedSince: Long get() = store.brickedSince
    val blockedPackages: Set<String> get() = store.blockedPackages
    val emergencyUnlocksLeft: Int get() = store.emergencyUnlocksLeft
    val strictMode: Boolean get() = store.strictMode

    fun brickedFor(): Long = (now() - store.brickedSince).coerceAtLeast(0)

    /**
     * A tag touched the phone. The first usable tag ever seen becomes the brick;
     * after that only that tag toggles the block.
     *
     * [blockerReady] is whether the accessibility service is switched on. Bricking
     * without it would look locked while blocking nothing, so it is refused.
     */
    fun onTagScanned(uid: ByteArray, blockerReady: Boolean): ScanResult {
        if (!isUsableUid(uid)) return ScanResult.UNUSABLE_TAG

        // A phone resting on the tag reads it over and over. Without this, one
        // tap could brick and immediately unbrick.
        val t = now()
        if (t - store.lastChangeAt in 0 until DEBOUNCE_MS) return ScanResult.IGNORED

        val id = uid.toHex()
        val paired = store.pairedTagId
        if (paired == null) {
            store.pairedTagId = id
            store.lastChangeAt = t
            return ScanResult.PAIRED
        }
        if (paired != id) return ScanResult.WRONG_TAG

        if (store.bricked) {
            unbrick(t)
            return ScanResult.UNBRICKED
        }
        if (store.blockedPackages.isEmpty()) return ScanResult.NO_APPS
        if (!blockerReady) return ScanResult.BLOCKER_OFF

        store.bricked = true
        store.brickedSince = t
        store.lastChangeAt = t
        return ScanResult.BRICKED
    }

    /** Whether the window that just came to the front has to be covered. */
    fun shouldBlock(pkg: String, className: String? = null): Boolean {
        if (!store.bricked || pkg == ownPackage) return false
        if (pkg in store.blockedPackages) return true
        if (!store.strictMode) return false
        // Strict mode closes the two easy ways out: switching the service off in
        // Settings, and uninstalling the app.
        if (pkg in SETTINGS_PACKAGES) return true
        return pkg.endsWith("packageinstaller") &&
            className?.contains("uninstall", ignoreCase = true) == true
    }

    /** Unbrick without the tag. Each use spends one of a small, fixed supply. */
    fun emergencyUnlock(): Boolean {
        if (!store.bricked || store.emergencyUnlocksLeft <= 0) return false
        store.emergencyUnlocksLeft -= 1
        unbrick(now())
        return true
    }

    // Settings only change while unbricked: otherwise emptying the app list
    // would be a one-tap way out.

    fun setBlockedPackages(packages: Set<String>): Boolean {
        if (store.bricked) return false
        store.blockedPackages = packages - ownPackage
        return true
    }

    fun setStrictMode(on: Boolean): Boolean {
        if (store.bricked) return false
        store.strictMode = on
        return true
    }

    fun resetEmergencyUnlocks(): Boolean {
        if (store.bricked) return false
        store.emergencyUnlocksLeft = MAX_EMERGENCY_UNLOCKS
        return true
    }

    fun forgetTag(): Boolean {
        if (store.bricked) return false
        store.pairedTagId = null
        return true
    }

    private fun unbrick(t: Long) {
        store.bricked = false
        store.lastChangeAt = t
    }

    companion object {
        const val MAX_EMERGENCY_UNLOCKS = 5
        const val DEBOUNCE_MS = 2_000L

        val SETTINGS_PACKAGES = setOf("com.android.settings", "com.samsung.android.settings")

        /**
         * Phones and some bank or transit cards make up a new 4-byte ID starting
         * with 0x08 on every tap. Pairing with one would lock the owner out.
         */
        fun isUsableUid(uid: ByteArray): Boolean =
            uid.isNotEmpty() && !(uid.size == 4 && uid[0] == 0x08.toByte())

        fun ByteArray.toHex(): String = joinToString("") { "%02X".format(it) }

        fun formatDuration(ms: Long): String {
            val minutes = ms / 60_000
            val hours = minutes / 60
            val days = hours / 24
            return when {
                minutes < 1 -> "less than a minute"
                hours < 1 -> "$minutes min"
                days < 1 -> "$hours h ${minutes % 60} min"
                else -> "$days d ${hours % 24} h"
            }
        }
    }
}
