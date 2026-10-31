package pt.cryptoconex.mobile

import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjection
import android.util.Log
import io.socket.client.Ack
import io.socket.client.IO
import io.socket.client.Socket
import io.socket.engineio.client.transports.Polling
import io.socket.engineio.client.transports.WebSocket
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import org.webrtc.*
import java.util.concurrent.Executors
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Assistance session: socket signalling + WebRTC screen stream (H.264/VP8 via MediaCodec hardware encoders). */
object Assist {
    private const val TAG = "Assist"
    enum class Phase { IDLE, CONNECTING, WAITING, ACTIVE, ENDED }
    data class State(
        val phase: Phase = Phase.IDLE, val tech: String? = null, val online: Boolean = true,
        val privacy: Boolean = false, val privacyAsk: Boolean = false, val message: String = "", val control: Boolean = false,
    )

    val state = MutableStateFlow(State())
    private val exec = Executors.newSingleThreadExecutor()
    private lateinit var ctx: Context
    private var reg: Api.Registration? = null
    private var socket: Socket? = null
    private var sessionId: String? = null
    private var ice: List<PeerConnection.IceServer> = emptyList()
    private var egl: EglBase? = null
    private var factory: PeerConnectionFactory? = null
    private var capturer: ScreenCapturerAndroid? = null
    private var helper: SurfaceTextureHelper? = null
    private var source: VideoSource? = null
    private var track: VideoTrack? = null
    private var pc: PeerConnection? = null
    private val pendingIce = mutableListOf<IceCandidate>()
    private var screen = ""

    private fun update(f: (State) -> State) { state.value = f(state.value) }

    fun start(context: Context, projection: Intent) {
        ctx = context.applicationContext
        update { State(phase = Phase.CONNECTING) }
        exec.execute {
            var attempt = 0
            while (true) {
                try {
                    reg = Api.register(ctx)
                    ice = Api.iceServers(reg!!.token)
                    break
                } catch (e: Exception) {
                    update { it.copy(online = false, message = "Sem internet. A tentar de novo…") }
                    Thread.sleep(min(30_000L, 1000L shl min(attempt++, 5)))
                    if (state.value.phase == Phase.ENDED) return@execute
                }
            }
            try {
                setupCapture(projection)
            } catch (e: Exception) {
                Log.e(TAG, "capture", e)
                end(false); return@execute
            }
            connectSocket()
        }
    }

    private fun setupCapture(projection: Intent) {
        PeerConnectionFactory.initialize(PeerConnectionFactory.InitializationOptions.builder(ctx).createInitializationOptions())
        val e = EglBase.create(); egl = e
        factory = PeerConnectionFactory.builder()
            .setVideoEncoderFactory(DefaultVideoEncoderFactory(e.eglBaseContext, true, true))
            .setVideoDecoderFactory(DefaultVideoDecoderFactory(e.eglBaseContext))
            .createPeerConnectionFactory()
        val dm = ctx.resources.displayMetrics
        val scale = min(1.0, 1600.0 / max(dm.widthPixels, dm.heightPixels))
        val w = (dm.widthPixels * scale).roundToInt() and 1.inv()
        val h = (dm.heightPixels * scale).roundToInt() and 1.inv()
        screen = "${dm.widthPixels}x${dm.heightPixels}"
        val cap = ScreenCapturerAndroid(projection, object : MediaProjection.Callback() {
            override fun onStop() { end(true) }
        })
        helper = SurfaceTextureHelper.create("ScreenCapture", e.eglBaseContext)
        source = factory!!.createVideoSource(true)
        cap.initialize(helper, ctx, source!!.capturerObserver)
        cap.startCapture(w, h, 30)
        capturer = cap
        track = factory!!.createVideoTrack("screen", source)
    }

    private fun connectSocket() {
        val r = reg ?: return
        val opts = IO.Options().apply {
            path = "/api/socket.io"
            reconnection = true
            reconnectionDelay = 1000
            reconnectionDelayMax = 15000
            randomizationFactor = 0.5
            transports = arrayOf(WebSocket.NAME, Polling.NAME)
            auth = mapOf("token" to r.token, "kind" to "device")
        }
        val s = IO.socket(Api.BASE, opts)
        socket = s
        s.on(Socket.EVENT_CONNECT) { update { it.copy(online = true, message = "") }; requestSupport() }
        s.on(Socket.EVENT_DISCONNECT) { update { it.copy(online = false, message = "Sem internet. A ligar de novo…") } }
        s.on(Socket.EVENT_CONNECT_ERROR) { args ->
            update { it.copy(online = false) }
            if (args.firstOrNull()?.toString()?.contains("unauthorized") == true) exec.execute {
                s.off(); s.close()
                try { reg = Api.register(ctx) } catch (_: Exception) { Thread.sleep(5000) }
                if (state.value.phase != Phase.ENDED) connectSocket()
            }
        }
        s.on("support:assigned") { a -> update { it.copy(tech = (a[0] as JSONObject).optString("technician_name")) } }
        s.on("support:rejected") { update { it.copy(tech = null) } }
        s.on("session:started") { a -> update { it.copy(phase = Phase.ACTIVE, tech = (a[0] as JSONObject).optString("technician_name")) } }
        s.on("webrtc:request-offer") { exec.execute { makeOffer() } }
        s.on("webrtc:answer") { a -> onAnswer(a[0] as JSONObject) }
        s.on("webrtc:ice-candidate") { a -> onRemoteIce(a[0] as JSONObject) }
        s.on("remote:command") { a ->
            val cmd = (a[0] as JSONObject).optJSONObject("command") ?: return@on
            if (state.value.control) AssistAccessibilityService.instance?.perform(cmd)
        }
        s.on("accessibility:request") {
            val tree = AssistAccessibilityService.instance?.dumpTree() ?: JSONObject().put("package", "serviço de acessibilidade desligado")
            s.emit("accessibility:tree", tree.put("session_id", sessionId))
        }
        s.on("privacy:enabled") { update { it.copy(privacy = true, privacyAsk = false) }; AssistAccessibilityService.instance?.showPrivacy(true) }
        s.on("privacy:disabled") { update { it.copy(privacy = false, privacyAsk = false) }; AssistAccessibilityService.instance?.showPrivacy(false) }
        s.on("privacy:request-disable") { update { it.copy(privacyAsk = true) } }
        s.on("chat:message") { a ->
            val m = a[0] as JSONObject
            if (m.optString("from") != "device") update { it.copy(message = "${m.optString("author")}: ${m.optString("text")}") }
        }
        s.on("session:ended") { exec.execute { end(false) } }
        s.connect()
    }

    private fun requestSupport() {
        val body = JSONObject().put("consent_screen", true).put("screen", screen).put("link_code", "")
        socket?.emit("support:request", body, Ack { args ->
            val j = args.firstOrNull() as? JSONObject ?: return@Ack
            if (!j.optBoolean("ok")) { update { it.copy(message = j.optString("error")) }; return@Ack }
            val sess = j.getJSONObject("session")
            sessionId = sess.getString("id")
            val active = sess.optString("status") == "active"
            update { it.copy(phase = if (active) Phase.ACTIVE else Phase.WAITING, tech = sess.optString("technician_name").takeIf { n -> n.isNotBlank() && n != "null" }) }
            socket?.emit("session:status", JSONObject().put("session_id", sessionId).put("resolution", screen))
            if (state.value.control) sendConsent(true)
        })
    }

    private fun makeOffer() {
        val f = factory ?: return
        pc?.dispose(); pendingIce.clear()
        val cfg = PeerConnection.RTCConfiguration(ice).apply {
            sdpSemantics = PeerConnection.SdpSemantics.UNIFIED_PLAN
            bundlePolicy = PeerConnection.BundlePolicy.MAXBUNDLE
            continualGatheringPolicy = PeerConnection.ContinualGatheringPolicy.GATHER_CONTINUALLY
        }
        val conn = f.createPeerConnection(cfg, object : PeerConnection.Observer {
            override fun onIceCandidate(c: IceCandidate) {
                val cand = JSONObject().put("candidate", c.sdp).put("sdpMid", c.sdpMid).put("sdpMLineIndex", c.sdpMLineIndex)
                socket?.emit("webrtc:ice-candidate", JSONObject().put("session_id", sessionId).put("candidate", cand))
            }
            override fun onConnectionChange(s: PeerConnection.PeerConnectionState) {
                socket?.emit("session:status", JSONObject().put("session_id", sessionId).put("connection_state", s.name.lowercase()))
            }
            override fun onSignalingChange(s: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(s: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(b: Boolean) {}
            override fun onIceGatheringChange(s: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(c: Array<out IceCandidate>) {}
            override fun onAddStream(s: MediaStream) {}
            override fun onRemoveStream(s: MediaStream) {}
            override fun onDataChannel(d: DataChannel) {}
            override fun onRenegotiationNeeded() {}
        }) ?: return
        pc = conn
        val sender = conn.addTrack(track, listOf("screen"))
        val p = sender.parameters
        p.degradationPreference = RtpParameters.DegradationPreference.BALANCED
        p.encodings.firstOrNull()?.let { it.maxBitrateBps = 2_500_000; it.maxFramerate = 30 }
        sender.setParameters(p)
        conn.createOffer(object : Sdp() {
            override fun onCreateSuccess(desc: SessionDescription) {
                conn.setLocalDescription(object : Sdp() {
                    override fun onSetSuccess() {
                        val sdp = JSONObject().put("type", "offer").put("sdp", desc.description)
                        socket?.emit("webrtc:offer", JSONObject().put("session_id", sessionId).put("sdp", sdp))
                    }
                }, desc)
            }
        }, MediaConstraints())
    }

    private fun onAnswer(d: JSONObject) {
        val conn = pc ?: return
        val sdp = d.getJSONObject("sdp").getString("sdp")
        conn.setRemoteDescription(object : Sdp() {
            override fun onSetSuccess() { exec.execute { pendingIce.forEach { conn.addIceCandidate(it) }; pendingIce.clear() } }
        }, SessionDescription(SessionDescription.Type.ANSWER, sdp))
    }

    private fun onRemoteIce(d: JSONObject) {
        val c = d.optJSONObject("candidate") ?: return
        val cand = IceCandidate(c.optString("sdpMid"), c.optInt("sdpMLineIndex"), c.optString("candidate"))
        exec.execute {
            val conn = pc ?: return@execute
            if (conn.remoteDescription == null) pendingIce.add(cand) else conn.addIceCandidate(cand)
        }
    }

    private fun sendConsent(control: Boolean) {
        val id = sessionId ?: return
        socket?.emit("consent:update", JSONObject().put("session_id", id).put("control", control))
    }

    fun setControl(allowed: Boolean) { update { it.copy(control = allowed) }; sendConsent(allowed) }

    fun disablePrivacy() {
        socket?.emit("privacy:disable", JSONObject().put("session_id", sessionId))
        update { it.copy(privacy = false, privacyAsk = false) }
        AssistAccessibilityService.instance?.showPrivacy(false)
    }

    /** Stops everything immediately: capture, stream, socket and the foreground service. */
    fun end(notify: Boolean) {
        if (notify && sessionId != null) socket?.emit("session:end", JSONObject().put("session_id", sessionId))
        AssistAccessibilityService.instance?.showPrivacy(false)
        try { capturer?.stopCapture() } catch (_: Exception) {}
        capturer?.dispose(); capturer = null
        pc?.dispose(); pc = null
        track?.dispose(); track = null
        source?.dispose(); source = null
        helper?.dispose(); helper = null
        factory?.dispose(); factory = null
        egl?.release(); egl = null
        socket?.off(); socket?.disconnect(); socket = null
        sessionId = null
        update { State(phase = Phase.ENDED) }
        if (::ctx.isInitialized) ctx.stopService(Intent(ctx, ScreenShareService::class.java))
    }

    open class Sdp : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) {}
        override fun onSetSuccess() {}
        override fun onCreateFailure(e: String?) { Log.w(TAG, "sdp create $e") }
        override fun onSetFailure(e: String?) { Log.w(TAG, "sdp set $e") }
    }
}
