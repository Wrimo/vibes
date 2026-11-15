package dev.vibes.brick

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.HapticFeedbackConstants
import android.widget.Button
import android.widget.TextView

/** The wall that goes up over a blocked app. Tapping the tag here takes it down. */
class BlockActivity : Activity() {

    private lateinit var controller: BrickController
    private lateinit var scanner: NfcScanner

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        controller = Brick.controller(this)
        scanner = NfcScanner(this, ::onScan)
        setContentView(R.layout.activity_block)

        findViewById<Button>(R.id.homeButton).setOnClickListener { goHome() }
        findViewById<Button>(R.id.emergencyButton).setOnClickListener {
            val left = controller.emergencyUnlocksLeft
            AlertDialog.Builder(this)
                .setMessage(getString(R.string.emergency_confirm, left - 1))
                .setPositiveButton(android.R.string.ok) { _, _ ->
                    if (controller.emergencyUnlock()) finish()
                }
                .setNegativeButton(android.R.string.cancel, null)
                .show()
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        if (!controller.isBricked) {
            finish()
            return
        }
        scanner.start()
        render()
    }

    override fun onPause() {
        super.onPause()
        scanner.stop()
    }

    // Back would land on the blocked app, which would only bring this screen
    // straight back. Leave to the home screen instead.
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() = goHome()

    private fun onScan(uid: ByteArray) {
        when (controller.onTagScanned(uid, Brick.isBlockerEnabled(this))) {
            ScanResult.UNBRICKED -> {
                window.decorView.performHapticFeedback(HapticFeedbackConstants.LONG_PRESS)
                finish() // reveals the app underneath, which is now allowed
            }
            ScanResult.WRONG_TAG, ScanResult.UNUSABLE_TAG ->
                findViewById<TextView>(R.id.hint).setText(R.string.scan_wrong_tag)
            else -> Unit
        }
    }

    private fun render() {
        val pkg = intent.getStringExtra(EXTRA_PACKAGE)
        val label = pkg?.let {
            runCatching {
                packageManager.getApplicationLabel(packageManager.getApplicationInfo(it, 0))
            }.getOrNull()
        }
        findViewById<TextView>(R.id.blockedApp).text =
            if (label != null) getString(R.string.block_app, label)
            else getString(R.string.block_app_unknown)
        findViewById<TextView>(R.id.duration).text = getString(
            R.string.block_duration,
            BrickController.formatDuration(controller.brickedFor()),
        )
        val left = controller.emergencyUnlocksLeft
        findViewById<Button>(R.id.emergencyButton).apply {
            text = getString(R.string.block_emergency, left)
            isEnabled = left > 0
        }
    }

    private fun goHome() {
        startActivity(
            Intent(Intent.ACTION_MAIN)
                .addCategory(Intent.CATEGORY_HOME)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        )
        finish()
    }

    companion object {
        private const val EXTRA_PACKAGE = "package"

        fun intent(context: Context, blockedPackage: String): Intent =
            Intent(context, BlockActivity::class.java)
                .putExtra(EXTRA_PACKAGE, blockedPackage)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
}
