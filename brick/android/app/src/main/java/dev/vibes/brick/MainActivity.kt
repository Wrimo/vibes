package dev.vibes.brick

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.nfc.NfcAdapter
import android.nfc.Tag
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.HapticFeedbackConstants
import android.view.View
import android.widget.Button
import android.widget.Switch
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var controller: BrickController
    private lateinit var scanner: NfcScanner
    private val ticker = Handler(Looper.getMainLooper())
    private val tick = object : Runnable {
        override fun run() {
            render()
            ticker.postDelayed(this, 30_000)
        }
    }
    private var message: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = Brick.controller(this)
        scanner = NfcScanner(this, ::onScan)
        setContentView(R.layout.activity_main)

        findViewById<Button>(R.id.appsButton).setOnClickListener {
            startActivity(Intent(this, AppPickerActivity::class.java))
        }
        findViewById<Switch>(R.id.strictSwitch).setOnClickListener {
            controller.setStrictMode((it as Switch).isChecked)
            render()
        }
        findViewById<Button>(R.id.emergencyButton).setOnClickListener { onEmergencyButton() }
        findViewById<Button>(R.id.forgetButton).setOnClickListener {
            confirm(R.string.forget_confirm) {
                controller.forgetTag()
                message = null
                render()
            }
        }

        // A rotation re-delivers the launch intent; only a fresh launch counts as a tap.
        if (savedInstanceState == null) handleTagIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleTagIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        scanner.start()
        ticker.post(tick)
    }

    override fun onPause() {
        super.onPause()
        scanner.stop()
        ticker.removeCallbacks(tick)
    }

    /** The tag was tapped while the app was closed and Android opened us for it. */
    private fun handleTagIntent(intent: Intent?) {
        if (intent?.action != NfcAdapter.ACTION_TECH_DISCOVERED) return
        if (intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY != 0) return
        @Suppress("DEPRECATION")
        val tag = intent.getParcelableExtra<Tag>(NfcAdapter.EXTRA_TAG) ?: return
        setIntent(Intent(this, MainActivity::class.java))
        onScan(tag.id)
    }

    internal fun onScan(uid: ByteArray) {
        val result = controller.onTagScanned(uid, Brick.isBlockerEnabled(this))
        if (result == ScanResult.IGNORED) return
        message = getString(
            when (result) {
                ScanResult.PAIRED -> R.string.scan_paired
                ScanResult.BRICKED -> R.string.scan_bricked
                ScanResult.UNBRICKED -> R.string.scan_unbricked
                ScanResult.WRONG_TAG -> R.string.scan_wrong_tag
                ScanResult.UNUSABLE_TAG -> R.string.scan_unusable_tag
                ScanResult.NO_APPS -> R.string.scan_no_apps
                ScanResult.BLOCKER_OFF -> R.string.scan_blocker_off
                ScanResult.IGNORED -> return
            }
        )
        window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
        render()
    }

    private fun onEmergencyButton() {
        if (controller.isBricked) {
            val left = controller.emergencyUnlocksLeft
            confirm(getString(R.string.emergency_confirm, left - 1)) {
                controller.emergencyUnlock()
                message = getString(R.string.emergency_used)
                render()
            }
        } else {
            confirm(R.string.emergency_reset_confirm) {
                controller.resetEmergencyUnlocks()
                render()
            }
        }
    }

    private fun render() {
        val bricked = controller.isBricked
        val appCount = controller.blockedPackages.size
        val left = controller.emergencyUnlocksLeft
        val max = BrickController.MAX_EMERGENCY_UNLOCKS

        findViewById<TextView>(R.id.statusTitle).apply {
            setText(if (bricked) R.string.status_bricked else R.string.status_unbricked)
            setTextColor(getColor(if (bricked) R.color.accent else R.color.text))
        }
        findViewById<TextView>(R.id.statusDetail).text = when {
            bricked -> getString(
                R.string.detail_bricked,
                resources.getQuantityString(R.plurals.apps, appCount, appCount),
                BrickController.formatDuration(controller.brickedFor()),
            )
            !controller.isPaired -> getString(R.string.detail_unpaired)
            else -> getString(R.string.detail_unbricked)
        }
        findViewById<TextView>(R.id.message).apply {
            text = message
            visibility = if (message == null) View.GONE else View.VISIBLE
        }

        renderSetup(bricked)

        findViewById<Button>(R.id.appsButton).apply {
            text = getString(R.string.apps_button, appCount)
            isEnabled = !bricked
        }
        findViewById<Switch>(R.id.strictSwitch).apply {
            isChecked = controller.strictMode
            isEnabled = !bricked
        }
        findViewById<TextView>(R.id.emergencyInfo).text =
            getString(R.string.emergency_info, left, max)
        findViewById<Button>(R.id.emergencyButton).apply {
            setText(if (bricked) R.string.emergency_unlock else R.string.emergency_reset)
            // Bricked: usable while any remain. Unbricked: only there to refill.
            isEnabled = if (bricked) left > 0 else left < max
        }
        findViewById<Button>(R.id.forgetButton).apply {
            isEnabled = !bricked
            visibility = if (controller.isPaired) View.VISIBLE else View.GONE
        }
    }

    /** Shows the single next thing standing between the user and a working brick. */
    private fun renderSetup(bricked: Boolean) {
        val card = findViewById<View>(R.id.setupCard)
        val text = findViewById<TextView>(R.id.setupText)
        val action = findViewById<Button>(R.id.setupAction)

        fun step(textRes: Int, buttonRes: Int? = null, intent: Intent? = null) {
            card.visibility = View.VISIBLE
            text.setText(textRes)
            if (buttonRes == null || intent == null) {
                action.visibility = View.GONE
            } else {
                action.visibility = View.VISIBLE
                action.setText(buttonRes)
                action.setOnClickListener { runCatching { startActivity(intent) } }
            }
        }

        val blockerOn = Brick.isBlockerEnabled(this)
        when {
            !scanner.hasNfc -> step(R.string.setup_no_nfc)
            !scanner.isOn -> step(
                R.string.setup_nfc_off, R.string.setup_nfc_action,
                Intent(Settings.ACTION_NFC_SETTINGS),
            )
            bricked && !blockerOn -> step(
                R.string.setup_blocker_off_while_bricked, R.string.setup_blocker_action,
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            )
            bricked -> card.visibility = View.GONE
            !controller.isPaired -> step(R.string.setup_pair)
            controller.blockedPackages.isEmpty() -> step(
                R.string.setup_apps, R.string.setup_apps_action,
                Intent(this, AppPickerActivity::class.java),
            )
            !blockerOn -> step(
                R.string.setup_blocker, R.string.setup_blocker_action,
                Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS),
            )
            else -> card.visibility = View.GONE
        }
    }

    private fun confirm(messageRes: Int, onYes: () -> Unit) = confirm(getString(messageRes), onYes)

    private fun confirm(text: String, onYes: () -> Unit) {
        AlertDialog.Builder(this)
            .setMessage(text)
            .setPositiveButton(android.R.string.ok) { _, _ -> onYes() }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }
}
