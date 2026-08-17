package com.companionintelligence.app.localllm

import android.os.Build
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * On-device chat completion (Phase 3 "Thinks" of the disconnected-mode design doc). The
 * JS bridge is control-plane only — start/stop/status/model management — matching
 * `frontend/packages/common/src/utils/nativeBridge.ts`'s `LocalLLMPlugin` interface.
 * Actual chat traffic goes straight from the web bundle to the loopback HTTP server this
 * plugin starts, so the same fetch/SSE code path used for the appliance works unchanged.
 *
 * LiteRT-LM's AAR declares minSdk 31 (see AndroidManifest.xml's `overrideLibrary`); the
 * app itself stays at minSdk 23, so this plugin gates itself with [isSupported] instead
 * of forcing every device onto the newer floor.
 */
@CapacitorPlugin(name = "LocalLLM")
class LocalLlmPlugin : Plugin() {
  private val engine = LocalLlmEngine()
  private var server: LocalLlmHttpServer? = null
  private var token: String? = null
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

  private val isSupported: Boolean
    get() = Build.VERSION.SDK_INT >= 31

  @PluginMethod
  fun getStatus(call: PluginCall) {
    val result = JSObject()
    result.put("supported", isSupported)
    result.put("running", server != null)
    result.put("modelLoaded", engine.isLoaded)
    result.put("modelPath", engine.modelPath)
    server?.let { result.put("baseUrl", "http://127.0.0.1:${it.boundPort}") }
    call.resolve(result)
  }

  @PluginMethod
  fun start(call: PluginCall) {
    if (!isSupported) {
      call.reject("LocalLLM requires Android 12 (API 31) or newer")
      return
    }

    server?.let {
      resolveStarted(call, it)
      return
    }

    val newToken = generateToken()
    val newServer = LocalLlmHttpServer(engine, newToken)
    try {
      newServer.start()
    } catch (e: Exception) {
      call.reject("Failed to start local server: ${e.message}")
      return
    }
    server = newServer
    token = newToken
    resolveStarted(call, newServer)
  }

  private fun resolveStarted(call: PluginCall, running: LocalLlmHttpServer) {
    val result = JSObject()
    result.put("baseUrl", "http://127.0.0.1:${running.boundPort}")
    result.put("token", token)
    call.resolve(result)
  }

  @PluginMethod
  fun stop(call: PluginCall) {
    server?.stop()
    server = null
    token = null
    call.resolve()
  }

  @PluginMethod
  fun loadModel(call: PluginCall) {
    val path = call.getString("path")
    if (path == null) {
      call.reject("path is required")
      return
    }
    if (!File(path).exists()) {
      call.reject("Model file not found at $path")
      return
    }
    scope.launch {
      try {
        engine.load(path)
        call.resolve()
      } catch (e: Exception) {
        call.reject("Failed to load model: ${e.message}")
      }
    }
  }

  @PluginMethod
  fun unloadModel(call: PluginCall) {
    scope.launch {
      engine.unload()
      call.resolve()
    }
  }

  @PluginMethod
  fun downloadModel(call: PluginCall) {
    val url = call.getString("url")
    val fileName = call.getString("fileName")
    if (url == null || fileName == null) {
      call.reject("url and fileName are required")
      return
    }
    scope.launch {
      try {
        val outFile =
          withContext(Dispatchers.IO) {
            val dir = File(context.getExternalFilesDir(null) ?: context.filesDir, "local-llm-models")
            dir.mkdirs()
            val dest = File(dir, fileName)
            downloadWithProgress(url, dest) { downloaded, total ->
              val progress = JSObject()
              progress.put("fileName", fileName)
              progress.put("downloaded", downloaded)
              progress.put("total", total)
              notifyListeners("downloadProgress", progress)
            }
            dest
          }
        val result = JSObject()
        result.put("path", outFile.absolutePath)
        call.resolve(result)
      } catch (e: Exception) {
        call.reject("Download failed: ${e.message}")
      }
    }
  }

  private fun downloadWithProgress(urlString: String, dest: File, onProgress: (Long, Long) -> Unit) {
    val connection = URL(urlString).openConnection() as HttpURLConnection
    connection.connect()
    val total = connection.contentLengthLong
    connection.inputStream.use { input ->
      dest.outputStream().use { output ->
        val buffer = ByteArray(64 * 1024)
        var downloaded = 0L
        var read: Int
        while (input.read(buffer).also { read = it } != -1) {
          output.write(buffer, 0, read)
          downloaded += read
          onProgress(downloaded, total)
        }
      }
    }
  }

  private fun generateToken(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return bytes.joinToString(separator = "") { "%02x".format(it) }
  }

  override fun handleOnDestroy() {
    server?.stop()
    server = null
  }
}
