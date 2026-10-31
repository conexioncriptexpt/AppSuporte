package pt.cryptoconex.mobile

import android.Manifest
import android.app.Dialog
import android.content.Intent
import android.graphics.Color
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch
import pt.cryptoconex.mobile.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var b: ActivityMainBinding
    private var privacyDialog: Dialog? = null

    private val projection = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { r ->
        if (r.resultCode == RESULT_OK && r.data != null) {
            val i = Intent(this, ScreenShareService::class.java).putExtra("data", r.data)
            ContextCompat.startForegroundService(this, i)
        } else {
            b.status.text = "A partilha do ecrã não foi autorizada. Carrega em CONECTAR para tentar de novo."
        }
    }

    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        b = ActivityMainBinding.inflate(layoutInflater)
        setContentView(b.root)
        if (Build.VERSION.SDK_INT >= 33) notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)

        b.connect.setOnClickListener {
            val mpm = getSystemService(MediaProjectionManager::class.java)
            b.status.text = "Vai aparecer um pedido do Android. Carrega em \"Começar agora\"."
            projection.launch(mpm.createScreenCaptureIntent())
        }
        b.terminate.setOnClickListener { Assist.end(true) }
        b.allowTouch.setOnCheckedChangeListener { sw, checked ->
            if (checked && !AssistAccessibilityService.isEnabled(this)) {
                sw.isChecked = false
                explainA11y()
            } else if (checked != Assist.state.value.control) {
                Assist.setControl(checked)
            }
        }
        b.enableA11y.setOnClickListener { explainA11y() }

        lifecycleScope.launch { Assist.state.collect { render(it) } }
    }

    override fun onResume() {
        super.onResume()
        b.enableA11y.visibility = if (AssistAccessibilityService.isEnabled(this)) View.GONE else View.VISIBLE
    }

    private fun explainA11y() {
        AlertDialog.Builder(this)
            .setTitle("Ajuda por toque")
            .setMessage("Para o técnico poder tocar no ecrã por ti, ativa \"Ajuda por toque — Suporte Técnico\" nas definições de Acessibilidade.\n\nSó funciona durante a assistência e nunca escreve palavras-passe, PIN, cartões ou IBAN.")
            .setPositiveButton("Abrir definições") { _, _ -> startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)) }
            .setNegativeButton("Agora não", null)
            .show()
    }

    private fun render(s: Assist.State) {
        val inSession = s.phase == Assist.Phase.CONNECTING || s.phase == Assist.Phase.WAITING || s.phase == Assist.Phase.ACTIVE
        b.connect.visibility = if (inSession) View.GONE else View.VISIBLE
        b.terminate.visibility = if (inSession) View.VISIBLE else View.GONE
        b.touchRow.visibility = if (inSession) View.VISIBLE else View.GONE
        if (b.allowTouch.isChecked != s.control) b.allowTouch.isChecked = s.control
        val base = when (s.phase) {
            Assist.Phase.IDLE -> ""
            Assist.Phase.CONNECTING -> "A ligar…"
            Assist.Phase.WAITING -> if (s.tech != null) "Técnico ${s.tech} a caminho…" else "A aguardar técnico…"
            Assist.Phase.ACTIVE -> "Assistência ativa" + (s.tech?.let { "\nTécnico: $it" } ?: "")
            Assist.Phase.ENDED -> "Assistência terminada"
        }
        val net = if (!s.online && inSession) "\nSem internet. A ligar de novo…" else ""
        b.status.text = listOf(base + net, s.message).filter { it.isNotBlank() }.joinToString("\n")
        // Fallback privacy screen inside the app when the accessibility service is off.
        if (s.privacy && AssistAccessibilityService.instance == null) showPrivacyDialog(s.privacyAsk) else { privacyDialog?.dismiss(); privacyDialog = null }
    }

    private fun showPrivacyDialog(ask: Boolean) {
        if (privacyDialog != null) return
        val d = Dialog(this, android.R.style.Theme_Black_NoTitleBar_Fullscreen)
        d.setContentView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER; setBackgroundColor(Color.BLACK); setPadding(48, 48, 48, 48)
            addView(TextView(context).apply { text = getString(R.string.privacy_title); setTextColor(Color.WHITE); textSize = 30f; gravity = Gravity.CENTER })
            if (ask) addView(TextView(context).apply { text = "O técnico pede para desligares este modo."; setTextColor(Color.GREEN); gravity = Gravity.CENTER })
            addView(Button(context).apply { text = getString(R.string.privacy_off); setOnClickListener { Assist.disablePrivacy() } })
            addView(Button(context).apply { text = getString(R.string.terminate); setOnClickListener { Assist.end(true) } })
        })
        d.setCancelable(false)
        d.show()
        privacyDialog = d
    }
}
