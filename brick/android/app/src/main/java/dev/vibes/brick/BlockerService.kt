package dev.vibes.brick

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent

/**
 * Watches which app comes to the front and covers blocked ones.
 *
 * It is configured to receive window changes only and cannot read what is on
 * screen (see res/xml/accessibility_service.xml).
 */
class BlockerService : AccessibilityService() {

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
        val pkg = event.packageName?.toString() ?: return
        if (!Brick.controller(this).shouldBlock(pkg, event.className?.toString())) return
        startActivity(BlockActivity.intent(this, pkg))
    }

    override fun onInterrupt() = Unit
}
