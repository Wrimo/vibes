package dev.vibes.brick

import android.app.Activity
import android.content.ComponentName
import android.content.Context
import android.nfc.NfcAdapter
import android.provider.Settings

class PrefsStore(context: Context) : BrickStore {
    private val prefs =
        context.applicationContext.getSharedPreferences("brick", Context.MODE_PRIVATE)

    override var pairedTagId: String?
        get() = prefs.getString("tag", null)
        set(value) = prefs.edit().putString("tag", value).apply()

    override var bricked: Boolean
        get() = prefs.getBoolean("bricked", false)
        set(value) = prefs.edit().putBoolean("bricked", value).apply()

    override var brickedSince: Long
        get() = prefs.getLong("brickedSince", 0)
        set(value) = prefs.edit().putLong("brickedSince", value).apply()

    override var lastChangeAt: Long
        get() = prefs.getLong("lastChangeAt", 0)
        set(value) = prefs.edit().putLong("lastChangeAt", value).apply()

    override var blockedPackages: Set<String>
        // The set SharedPreferences hands back must not be modified or kept.
        get() = prefs.getStringSet("blocked", emptySet()).orEmpty().toSet()
        set(value) = prefs.edit().putStringSet("blocked", value.toSet()).apply()

    override var emergencyUnlocksLeft: Int
        get() = prefs.getInt("emergencyLeft", BrickController.MAX_EMERGENCY_UNLOCKS)
        set(value) = prefs.edit().putInt("emergencyLeft", value).apply()

    override var strictMode: Boolean
        get() = prefs.getBoolean("strict", false)
        set(value) = prefs.edit().putBoolean("strict", value).apply()
}

object Brick {
    fun controller(context: Context) =
        BrickController(PrefsStore(context), context.packageName)

    /** Whether the user has switched the blocking service on in Accessibility settings. */
    fun isBlockerEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val me = ComponentName(context, BlockerService::class.java)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
}

/** Reads tag serial numbers while an activity is on screen. */
class NfcScanner(private val activity: Activity, private val onUid: (ByteArray) -> Unit) {
    private val adapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)

    val hasNfc: Boolean get() = adapter != null
    val isOn: Boolean get() = adapter?.isEnabled == true

    fun start() {
        runCatching {
            adapter?.enableReaderMode(
                activity,
                { tag ->
                    val uid = tag.id
                    activity.runOnUiThread {
                        if (!activity.isFinishing && !activity.isDestroyed) onUid(uid)
                    }
                },
                FLAGS,
                null,
            )
        }
    }

    fun stop() {
        runCatching { adapter?.disableReaderMode(activity) }
    }

    private companion object {
        // Only the serial number is needed, so skip reading the tag's contents:
        // it makes the tap quicker and works with blank tags.
        const val FLAGS = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_NFC_F or
            NfcAdapter.FLAG_READER_NFC_V or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
    }
}
