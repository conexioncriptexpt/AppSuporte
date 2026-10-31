package pt.cryptoconex.mobile

import android.content.Context
import android.os.Build
import android.provider.Settings
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import org.webrtc.PeerConnection
import java.util.UUID
import java.util.concurrent.TimeUnit

/** REST calls to the backend: device registration (temporary token) and ICE servers. */
object Api {
    val BASE: String = BuildConfig.BACKEND_URL.trimEnd('/')
    private val http = OkHttpClient.Builder().connectTimeout(10, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).build()

    /** Installation identifier: random UUID generated once and kept in app storage. */
    fun installId(ctx: Context): String {
        val prefs = ctx.getSharedPreferences("conex", Context.MODE_PRIVATE)
        return prefs.getString("install_id", null) ?: UUID.randomUUID().toString().also {
            prefs.edit().putString("install_id", it).apply()
        }
    }

    data class Registration(val deviceId: String, val token: String)

    fun register(ctx: Context): Registration {
        val name = Settings.Global.getString(ctx.contentResolver, Settings.Global.DEVICE_NAME) ?: "${Build.MANUFACTURER} ${Build.MODEL}"
        val body = JSONObject()
            .put("install_id", installId(ctx))
            .put("platform", "android")
            .put("os", "Android")
            .put("os_version", "${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            .put("name", name.take(80))
        val req = Request.Builder().url("$BASE/api/device/register")
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        http.newCall(req).execute().use { r ->
            if (!r.isSuccessful) throw IllegalStateException("register ${r.code}")
            val j = JSONObject(r.body!!.string())
            return Registration(j.getString("device_id"), j.getString("device_token"))
        }
    }

    fun iceServers(token: String): List<PeerConnection.IceServer> {
        val req = Request.Builder().url("$BASE/api/ice-servers").header("Authorization", "Bearer $token").build()
        return try {
            http.newCall(req).execute().use { r ->
                val arr = JSONObject(r.body!!.string()).getJSONArray("iceServers")
                (0 until arr.length()).map { i ->
                    val s = arr.getJSONObject(i)
                    val b = PeerConnection.IceServer.builder(s.getString("urls"))
                    if (s.has("username")) b.setUsername(s.getString("username")).setPassword(s.getString("credential"))
                    b.createIceServer()
                }
            }
        } catch (e: Exception) {
            listOf(PeerConnection.IceServer.builder("stun:stun.relay.metered.ca:80").createIceServer())
        }
    }
}
