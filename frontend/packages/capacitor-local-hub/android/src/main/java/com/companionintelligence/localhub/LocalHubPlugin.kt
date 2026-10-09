package com.companionintelligence.localhub

import android.Manifest
import android.content.Intent
import android.os.Build
import android.net.Uri
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PermissionState
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.companionintelligence.localhub.motion.MotionTracking
import com.companionintelligence.localhub.motion.MotionTrackingConfig
import java.security.SecureRandom
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * Android native half of the Local Hub sidecar. See `src/definitions.ts` for the JS-facing
 * contract this implements and this package's root `README.md` for the full multi-phase
 * design (local inference lands in a later pass behind [LocalHubServer], not here).
 *
 * All mutable state (the running [LocalHubServer] instance, its current bearer token, and
 * the [OutboxStore] handle) is only ever touched while holding [stateMutex], so concurrent
 * start()/stop()/getStatus() calls from JS -- e.g. a status poll racing a stop() -- can't
 * interleave into an inconsistent state.
 *
 * The `secure*` methods are a second, unrelated surface that happens to live here: they expose
 * [CompanionSecureStore] to JS so the appliance API key stops being held by
 * `capacitor-secure-storage-plugin`, which silently degrades to unencrypted Base64 when
 * Keystore initialisation fails. They take no locks -- SharedPreferences and `Cipher` are
 * already safe to use concurrently -- and deliberately share no state with the server
 * lifecycle, so reading a credential does not require the sidecar to be running.
 */
@CapacitorPlugin(
    name = "LocalHub",
    permissions = [
        // The two grants motion-gated background sampling needs, as Capacitor aliases so
        // startSignificantLocationUpdates can walk them in the order Android insists on
        // (fine first; background on its own prompt). Deliberately no ACTIVITY_RECOGNITION:
        // the motion signals are permission-free sensors and a geofence (see motion/).
        Permission(
            strings = [Manifest.permission.ACCESS_COARSE_LOCATION, Manifest.permission.ACCESS_FINE_LOCATION],
            alias = LocalHubPlugin.ALIAS_LOCATION,
        ),
        Permission(strings = ["android.permission.ACCESS_BACKGROUND_LOCATION"], alias = LocalHubPlugin.ALIAS_BACKGROUND_LOCATION),
    ],
)
class LocalHubPlugin : Plugin() {
    private val pluginScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val stateMutex = Mutex()

    private var server: LocalHubServer? = null
    private var token: String? = null

    /**
     * Outlives individual server instances on purpose: [stop] tears down the HTTP listener,
     * but the queued captures behind it are durable user data. The handle is the process-wide
     * one from [OutboxStores], shared with the motion tracker, and is never closed here.
     */
    private var outbox: OutboxStore? = null

    /** The pending `startSignificantLocationUpdates` options while its permission prompts run. */
    private var pendingMotionConfig: MotionTrackingConfig? = null

    /**
     * Further `startSignificantLocationUpdates` calls that arrived while the prompts were
     * already running. Android allows one permission request at a time, so a second chain
     * would lose its request outright and read as "denied"; these instead ride the chain
     * in flight and are resolved with its outcome, under the newest options.
     */
    private val waitingMotionCalls = mutableListOf<PluginCall>()

    override fun load() {
        // A WebView exists: route the tracker's queued fixes to JS as `significantLocation`
        // so the hook's lastOutcome follows background sampling. A process started by a
        // broadcast never gets here, and the tracker queues without a listener just the same.
        MotionTracking.get(context).listener = { body -> notifyListeners("significantLocation", JSObject.fromJSONObject(body)) }
        super.load()
    }

    override fun handleOnResume() {
        MotionTracking.get(context).onAppResumed()
        super.handleOnResume()
    }

    override fun handleOnPause() {
        MotionTracking.get(context).onAppPaused()
        super.handleOnPause()
    }

    override fun handleOnDestroy() {
        MotionTracking.get(context).listener = null
        // Synchronous best-effort cleanup: handleOnDestroy has no coroutine to await, but
        // NanoHTTPD#stop() already blocks until its listener thread has joined, so this is
        // a real stop, not a fire-and-forget one.
        server?.stop()
        server = null
        token = null
        // The shared store stays open for the process (see OutboxStores); every write was
        // already committed to disk before its HTTP response was sent.
        outbox = null
        pluginScope.cancel()
        super.handleOnDestroy()
    }

    /**
     * Starts the embedded server if not already running (fresh port + fresh token), or
     * returns the already-running instance's `baseUrl`/`token` unchanged. Resolves only
     * after the server socket is actually bound -- see [LocalHubServer]'s use of
     * NanoHTTPD's synchronous `start()`.
     */
    @PluginMethod
    fun start(call: PluginCall) {
        pluginScope.launch {
            try {
                val result = stateMutex.withLock { startLocked() }
                call.resolve(result)
            } catch (e: Exception) {
                call.reject("Failed to start Local Hub server: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        pluginScope.launch {
            try {
                stateMutex.withLock { stopLocked() }
                call.resolve()
            } catch (e: Exception) {
                call.reject("Failed to stop Local Hub server: ${e.message}", e)
            }
        }
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        pluginScope.launch {
            val ret = stateMutex.withLock { statusLocked() }
            call.resolve(ret)
        }
    }

    // ------------------------------------------------------------------ secure storage

    /**
     * Reads one value from [CompanionSecureStore], resolving `{ value: null }` when nothing is
     * stored under `key`.
     *
     * Rejects -- rather than resolving null -- when the keystore itself is unusable or a stored
     * blob no longer decrypts, so the two cases stay distinguishable at the bridge. The JS
     * `secureStorageGet` chooses to collapse both into "signed out"; that leniency belongs at
     * the call site, not here.
     */
    @PluginMethod
    fun secureGet(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) {
            call.reject("A non-empty 'key' is required")
            return
        }
        pluginScope.launch {
            try {
                val value = withContext(Dispatchers.IO) { credentialStore.get(key) }
                val ret = JSObject()
                // JSObject.put(String, null) would drop the entry; an explicit JSON null keeps
                // the shape of the resolved object stable for the TS side.
                if (value == null) ret.put("value", JSONObject.NULL) else ret.put("value", value)
                call.resolve(ret)
            } catch (e: Exception) {
                call.reject(e.message ?: "Secure storage read failed", e)
            }
        }
    }

    /**
     * Encrypts and commits one value. Rejects if it could not be stored **protected** -- there
     * is no plaintext fallback anywhere below this, which is the whole point of the store.
     *
     * Only the keys in [WRITABLE_SECURE_KEYS] are accepted. This app runs Capacitor's legacy
     * bridge (see `frontend/apps/android/capacitor.config.ts`), which reaches every frame in
     * the WebView, so the store does not take arbitrary names from whoever calls it.
     */
    @PluginMethod
    fun secureSet(call: PluginCall) {
        val key = call.getString("key")
        val value = call.getString("value")
        if (key.isNullOrEmpty()) {
            call.reject("A non-empty 'key' is required")
            return
        }
        if (key !in WRITABLE_SECURE_KEYS) {
            call.reject("'$key' is not a key this store accepts")
            return
        }
        if (value == null) {
            call.reject("A 'value' is required")
            return
        }
        pluginScope.launch {
            try {
                withContext(Dispatchers.IO) { credentialStore.set(key, value) }
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "Secure storage write failed", e)
            }
        }
    }

    /** Removes one value. Resolves successfully when it was already absent. */
    @PluginMethod
    fun secureRemove(call: PluginCall) {
        val key = call.getString("key")
        if (key.isNullOrEmpty()) {
            call.reject("A non-empty 'key' is required")
            return
        }
        pluginScope.launch {
            try {
                withContext(Dispatchers.IO) { credentialStore.remove(key) }
                call.resolve()
            } catch (e: Exception) {
                call.reject(e.message ?: "Secure storage remove failed", e)
            }
        }
    }

    /**
     * Opens a sign-in URL in Chrome Auth Tab (in-app sheet). Falls back to the
     * system browser when the activity never registered a launcher or nothing
     * can handle the Auth Tab intent. `companion://` still comes back through
     * `appUrlOpen` on both paths.
     *
     * With `external: true` the URL is not a sign-in (a provider's page from the
     * gallery, say) and goes straight to whichever app handles it. The Auth Tab
     * would hand any `companion://` address that page navigated to back to the
     * app as a sign-in result.
     */
    @PluginMethod
    fun openUrl(call: PluginCall) {
        val url = call.getString("url")
        val uri = if (url.isNullOrEmpty()) null else Uri.parse(url)
        val scheme = uri?.scheme?.lowercase()
        if (uri == null || (scheme != "https" && scheme != "http")) {
            call.reject("A valid http(s) url is required")
            return
        }
        val external = call.getBoolean("external", false) == true
        val host = activity
        if (host == null) {
            call.reject("Could not open the sign-in sheet.")
            return
        }
        host.runOnUiThread {
            try {
                if (external || !AuthTabSession.launch(uri)) {
                    openInSystemBrowser(host, uri)
                }
                call.resolve()
            } catch (e: Exception) {
                try {
                    openInSystemBrowser(host, uri)
                    call.resolve()
                } catch (fallback: Exception) {
                    call.reject(fallback.message ?: "Could not open URL", fallback)
                }
            }
        }
    }

    private fun openInSystemBrowser(host: android.app.Activity, uri: Uri) {
        host.startActivity(Intent(Intent.ACTION_VIEW, uri))
    }

    /**
     * iOS presents the Portal sign-in sheet here. Android keeps using [openUrl].
     * Declared so the shared plugin surface stays in lockstep.
     */
    @PluginMethod
    fun startAuthSession(call: PluginCall) {
        call.reject("In-app auth session is only available on iOS")
    }

    /**
     * One-shot high-accuracy fix ("use my location") is iOS-only for now -- see
     * `LocationTracker.swift`. Continuous background tracking on Android is owned
     * entirely by `@capacitor-community/background-geolocation`, not this plugin.
     */
    @PluginMethod
    fun getCurrentLocation(call: PluginCall) {
        call.reject("getCurrentLocation is only available on iOS")
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        try {
            val intent = Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            intent.data = Uri.fromParts("package", context.packageName, null)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve()
        } catch (e: Exception) {
            call.reject(e.message ?: "Could not open app settings", e)
        }
    }

    /** Always-authorization two-step is iOS-only. Android uses background-geolocation. */
    @PluginMethod
    fun getLocationAuthorization(call: PluginCall) {
        val ret = JSObject()
        ret.put("status", "unsupported")
        call.resolve(ret)
    }

    @PluginMethod
    fun requestLocationAuthorization(call: PluginCall) {
        val ret = JSObject()
        ret.put("status", "unsupported")
        call.resolve(ret)
    }

    /**
     * Android's Always mode: motion-gated background sampling (see
     * [com.companionintelligence.localhub.motion.MotionGatedTracker]). Walks the permission
     * prompts Android requires one at a time -- fine location, then background location
     * (its own prompt from API 30, and a Settings page from 31) -- and arms the tracker once
     * both are held. A refusal resolves the call and emits `significantLocationError`
     * `NOT_AUTHORIZED`, the same shape iOS uses, so the web side's "Open Settings" path lights
     * up. Nothing beyond the location grants is asked for: like iOS's significant-change
     * monitoring, the motion signals need no "Physical activity" permission.
     *
     * Options come from `@ci/common`'s `startSignificantLocationUpdates`; `deviceKey` is
     * required because without it no record can share the web side's `source_id`.
     */
    @PluginMethod
    fun startSignificantLocationUpdates(call: PluginCall) {
        val config = MotionTrackingConfig.fromJson(call.data)
        if (config == null) {
            call.reject("startSignificantLocationUpdates needs a non-empty deviceKey")
            return
        }
        val chainInFlight = pendingMotionConfig != null
        pendingMotionConfig = config
        if (chainInFlight) {
            waitingMotionCalls += call
            return
        }
        if (getPermissionState(ALIAS_LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(ALIAS_LOCATION, call, "motionLocationPermission")
            return
        }
        continueAfterLocation(call)
    }

    @PermissionCallback
    private fun motionLocationPermission(call: PluginCall) {
        continueAfterLocation(call)
    }

    private fun continueAfterLocation(call: PluginCall) {
        if (getPermissionState(ALIAS_LOCATION) != PermissionState.GRANTED) {
            finishMotionStart(call, authorized = false)
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && getPermissionState(ALIAS_BACKGROUND_LOCATION) != PermissionState.GRANTED) {
            requestPermissionForAlias(ALIAS_BACKGROUND_LOCATION, call, "motionBackgroundPermission")
            return
        }
        finishMotionStart(call, authorized = true)
    }

    @PermissionCallback
    private fun motionBackgroundPermission(call: PluginCall) {
        finishMotionStart(call, authorized = true)
    }

    private fun finishMotionStart(call: PluginCall, authorized: Boolean) {
        val config = pendingMotionConfig
        val calls = listOf(call) + waitingMotionCalls
        pendingMotionConfig = null
        waitingMotionCalls.clear()
        val backgroundHeld = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q ||
            getPermissionState(ALIAS_BACKGROUND_LOCATION) == PermissionState.GRANTED
        if (!authorized || config == null || !backgroundHeld) {
            val error = JSObject()
            error.put("code", "NOT_AUTHORIZED")
            notifyListeners("significantLocationError", error)
            calls.forEach { it.resolve() }
            return
        }
        pluginScope.launch {
            MotionTracking.get(context).arm(config)
            calls.forEach { it.resolve() }
        }
    }

    @PluginMethod
    fun stopSignificantLocationUpdates(call: PluginCall) {
        pendingMotionConfig = null
        waitingMotionCalls.forEach { it.resolve() }
        waitingMotionCalls.clear()
        pluginScope.launch {
            MotionTracking.get(context).disarm()
            call.resolve()
        }
    }

    /**
     * Lazy, not a field initializer: a `Plugin` is constructed before Capacitor attaches its
     * `Context`, so `context` is only safe to read once a method has actually been called.
     * `by lazy` is thread-safe, which matters because the three secure* methods run on
     * [pluginScope]'s IO dispatcher.
     */
    private val credentialStore: CompanionSecureStore by lazy { CompanionSecureStore.credentials(context) }

    /** Must hold [stateMutex]. */
    private suspend fun startLocked(): JSObject {
        val runningServer = server
        val runningToken = token
        if (runningServer != null && runningServer.isAlive && runningToken != null) {
            val ret = JSObject()
            ret.put("baseUrl", baseUrlFor(runningServer))
            ret.put("token", runningToken)
            return ret
        }

        // Clear out a half-dead previous instance (e.g. its accept thread died) before
        // starting a replacement.
        if (runningServer != null) {
            withContext(Dispatchers.IO) { runningServer.stop() }
        }

        val newToken = generateToken()
        // getContext() is the Capacitor bridge's Context; OutboxStore re-derives the
        // application context from it, so holding this store can't leak an Activity. The
        // database itself lands in app-private internal storage
        // (/data/data/<pkg>/databases/), which is where the durability guarantee comes from.
        val store = outbox ?: OutboxStores.shared(context).also { outbox = it }
        val newServer = LocalHubServer(newToken, store)

        withContext(Dispatchers.IO) {
            // Open (and, on first launch, create) the database here rather than lazily on the
            // first request: it makes a broken/corrupt outbox a start() failure the caller
            // can see, and keeps that disk I/O off the NanoHTTPD worker that would otherwise
            // pay for it mid-request. Since the outbox is encrypted, this is also where a
            // missing keystore key or a failed plaintext->encrypted migration surfaces -- as a
            // rejected start(), never as a silently empty queue.
            store.open()

            // NanoHTTPD#start busy-waits internally until the socket is actually bound (or
            // throws), so getListeningPort() below is valid the moment this call returns --
            // this is what keeps us from resolving a baseUrl before anything is listening.
            newServer.start(NANOHTTPD_SOCKET_READ_TIMEOUT_MS, true)
        }

        server = newServer
        token = newToken

        val ret = JSObject()
        ret.put("baseUrl", baseUrlFor(newServer))
        ret.put("token", newToken)
        return ret
    }

    /** Must hold [stateMutex]. */
    private suspend fun stopLocked() {
        val runningServer = server ?: return
        withContext(Dispatchers.IO) { runningServer.stop() }
        server = null
        token = null
    }

    /** Must hold [stateMutex]. */
    private fun statusLocked(): JSObject {
        val ret = JSObject()
        val runningServer = server?.takeIf { it.isAlive }
        ret.put("running", runningServer != null)
        if (runningServer != null) {
            ret.put("baseUrl", baseUrlFor(runningServer))
        }
        return ret
    }

    private fun baseUrlFor(server: LocalHubServer): String = "http://127.0.0.1:${server.listeningPort}"

    /** [TOKEN_BYTES] bytes from [SecureRandom], base64url-encoded without padding -- never persisted to disk. */
    private fun generateToken(): String {
        val bytes = ByteArray(TOKEN_BYTES)
        SecureRandom().nextBytes(bytes)
        return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    }

    companion object {
        const val ALIAS_LOCATION = "location"
        const val ALIAS_BACKGROUND_LOCATION = "backgroundLocation"

        /**
         * The credentials the app itself stores: the device API key, its id and capability, and
         * the paired Memory origin mirrored for native consumers. Kept equal to
         * `SECURE_STORE_KEYS` in `@ci/common`'s `nativeBridge.ts` and to the iOS plugin's list;
         * `capacitorPluginContract.test.ts` checks all three.
         */
        private val WRITABLE_SECURE_KEYS = setOf(
            "ci.apiKey",
            "ci.apiKeyId",
            "ci.apiKeyCapability",
            "ci.apiBaseUrl",
        )

        private const val TOKEN_BYTES = 32
        private const val NANOHTTPD_SOCKET_READ_TIMEOUT_MS = 5000
    }
}
