package pt.cryptoconex.mobile

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject

/**
 * Assisted navigation, enabled only by the user in Android Settings > Accessibility.
 * Commands are executed only while a session is active AND the user allowed touch in the app.
 */
class AssistAccessibilityService : AccessibilityService() {
    private var overlay: LinearLayout? = null

    override fun onServiceConnected() { instance = this }
    override fun onUnbind(intent: android.content.Intent?): Boolean { instance = null; return super.onUnbind(intent) }
    override fun onDestroy() { instance = null; super.onDestroy() }
    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private fun size(): Pair<Float, Float> {
        val wm = getSystemService(WINDOW_SERVICE) as WindowManager
        return if (Build.VERSION.SDK_INT >= 30) {
            val b = wm.currentWindowMetrics.bounds; b.width().toFloat() to b.height().toFloat()
        } else {
            val dm = android.util.DisplayMetrics()
            @Suppress("DEPRECATION") wm.defaultDisplay.getRealMetrics(dm)
            dm.widthPixels.toFloat() to dm.heightPixels.toFloat()
        }
    }

    private fun gesture(x1: Float, y1: Float, x2: Float, y2: Float, ms: Long) {
        val path = Path().apply { moveTo(x1, y1); if (x1 != x2 || y1 != y2) lineTo(x2, y2) }
        dispatchGesture(GestureDescription.Builder().addStroke(GestureDescription.StrokeDescription(path, 0, ms)).build(), null, null)
    }

    fun perform(cmd: JSONObject) {
        if (Assist.state.value.phase != Assist.Phase.ACTIVE) return
        val (w, h) = size()
        val x = (cmd.optDouble("x", 0.5) * w).toFloat()
        val y = (cmd.optDouble("y", 0.5) * h).toFloat()
        when (cmd.optString("type")) {
            "tap", "click" -> gesture(x, y, x, y, 60)
            "double_click" -> { gesture(x, y, x, y, 50); android.os.Handler(mainLooper).postDelayed({ gesture(x, y, x, y, 50) }, 120) }
            "right_click" -> gesture(x, y, x, y, 700)
            "swipe" -> gesture((cmd.optDouble("x1") * w).toFloat(), (cmd.optDouble("y1") * h).toFloat(),
                (cmd.optDouble("x2") * w).toFloat(), (cmd.optDouble("y2") * h).toFloat(), cmd.optLong("duration", 300).coerceIn(100, 1500))
            "scroll" -> if (cmd.optInt("dy") > 0) gesture(x, h * 0.7f, x, h * 0.3f, 300) else gesture(x, h * 0.3f, x, h * 0.7f, 300)
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "home" -> performGlobalAction(GLOBAL_ACTION_HOME)
            "recents" -> performGlobalAction(GLOBAL_ACTION_RECENTS)
            "text" -> typeText(cmd.optString("text"))
            "key" -> key(cmd.optString("key"))
        }
    }

    private fun focusedField(): AccessibilityNodeInfo? =
        rootInActiveWindow?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)?.takeIf { it.isEditable }

    /** Blocks password, PIN, card and IBAN fields so credentials and financial data are never typed remotely. */
    private fun sensitive(n: AccessibilityNodeInfo): Boolean {
        if (n.isPassword) return true
        val variation = n.inputType and InputType.TYPE_MASK_VARIATION
        if (variation == InputType.TYPE_TEXT_VARIATION_PASSWORD || variation == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD ||
            variation == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD || variation == InputType.TYPE_NUMBER_VARIATION_PASSWORD) return true
        val hay = listOf(n.hintText, n.viewIdResourceName, n.contentDescription, n.paneTitle).joinToString(" ").lowercase()
        return SENSITIVE.any { hay.contains(it) }
    }

    private fun typeText(text: String) {
        val n = focusedField() ?: return
        if (sensitive(n)) { blocked(); return }
        val current = n.text?.toString()?.takeIf { n.hintText == null || it != n.hintText.toString() } ?: ""
        n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, current + text)
        })
    }

    private fun key(k: String) {
        when (k) {
            "Escape" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "Enter" -> if (Build.VERSION.SDK_INT >= 30) focusedField()?.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
            "Backspace" -> focusedField()?.let { n ->
                if (sensitive(n)) { blocked(); return }
                val t = n.text?.toString() ?: return
                n.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, t.dropLast(1))
                })
            }
        }
    }

    private fun blocked() {
        Assist.state.value = Assist.state.value.copy(message = "Campo protegido: o técnico não pode escrever aqui.")
    }

    /** Readable description of the visible interface (UI hierarchy) for the technician. */
    fun dumpTree(): JSONObject {
        val root = rootInActiveWindow
        val nodes = JSONArray()
        fun walk(n: AccessibilityNodeInfo?, depth: Int) {
            if (n == null || nodes.length() >= 400 || depth > 30) return
            val text = n.text?.toString()
            val cls = n.className?.toString()?.substringAfterLast('.') ?: ""
            if (!text.isNullOrBlank() || n.contentDescription != null || n.isClickable || n.isEditable) {
                nodes.put(JSONObject()
                    .put("depth", depth).put("cls", cls)
                    .put("role", when { n.isEditable -> "Campo"; cls.contains("Button") -> "Botão"; n.isClickable -> "Clicável"; else -> "Texto" })
                    .put("text", if (n.isEditable && sensitive(n)) "•••• (protegido)" else text?.take(200) ?: "")
                    .put("desc", n.contentDescription?.toString()?.take(200) ?: "")
                    .put("clickable", n.isClickable).put("editable", n.isEditable))
            }
            for (i in 0 until n.childCount) walk(n.getChild(i), depth + 1)
        }
        walk(root, 0)
        return JSONObject().put("package", root?.packageName?.toString() ?: "").put("nodes", nodes)
    }

    /** Dark privacy screen. The user can always switch it off or end the session. */
    fun showPrivacy(show: Boolean) {
        android.os.Handler(mainLooper).post {
            val wm = getSystemService(WINDOW_SERVICE) as WindowManager
            if (!show) { overlay?.let { wm.removeView(it) }; overlay = null; return@post }
            if (overlay != null) return@post
            val v = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK); setPadding(48, 48, 48, 48)
                addView(TextView(context).apply { text = getString(R.string.privacy_title); setTextColor(Color.WHITE); textSize = 30f; gravity = Gravity.CENTER })
                addView(TextView(context).apply { text = "Modo de privacidade ativo"; setTextColor(Color.LTGRAY); textSize = 16f; gravity = Gravity.CENTER; setPadding(0, 24, 0, 48) })
                addView(Button(context).apply { text = getString(R.string.privacy_off); textSize = 20f; setOnClickListener { Assist.disablePrivacy() } })
                addView(Button(context).apply { text = getString(R.string.terminate); textSize = 20f; setBackgroundColor(Color.rgb(220, 38, 38)); setTextColor(Color.WHITE); setOnClickListener { Assist.end(true) } })
            }
            val lp = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN, PixelFormat.OPAQUE)
            wm.addView(v, lp)
            overlay = v
        }
    }

    companion object {
        @Volatile var instance: AssistAccessibilityService? = null
        private val SENSITIVE = listOf("password", "passwd", "palavra", "senha", "pin", "cvv", "cvc", "iban", "card", "cartao", "cartão", "otp", "codigo de seguranca")

        fun isEnabled(ctx: Context): Boolean {
            val enabled = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            return enabled.contains("${ctx.packageName}/") && instance != null
        }
    }
}
