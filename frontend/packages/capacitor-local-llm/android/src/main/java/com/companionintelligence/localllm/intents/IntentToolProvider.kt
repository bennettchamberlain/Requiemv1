package com.companionintelligence.localllm.intents

import android.util.Log
import com.google.ai.edge.litertlm.OpenApiTool
import com.google.ai.edge.litertlm.ToolProvider
import com.google.ai.edge.litertlm.tool
import org.json.JSONObject

/**
 * Binds CI's published intents to LiteRT-LM's tool calling — the Android half of the on-device
 * agent harness.
 *
 * Android can do this **dynamically**: [OpenApiTool] takes a hand-written function-description
 * JSON string and raw argument JSON, so one adapter turns *any* intent the appliance publishes
 * into a callable tool at runtime. Add an intent server-side and the phone picks it up on the next
 * catalog fetch, with no app release.
 *
 * iOS cannot do this, and the difference is structural rather than an oversight: LiteRT-LM's Swift
 * `Tool` is a `Decodable` protocol whose schema is produced by `Mirror`-reflecting compile-time
 * `@ToolParam` properties, and the Swift surface has no `OpenApiTool` equivalent. So the iOS side
 * hand-writes a struct per intent. Both platforms consume the same catalog and obey the same
 * server-computed ruling; only the binding differs.
 */
object IntentToolProvider {
    private const val TAG = "IntentToolProvider"

    /**
     * Builds tool providers for every intent the server says this device may execute.
     *
     * Returns an empty list rather than throwing when the catalog can't be read: a model that
     * answers from its own weights is a worse assistant, but it is still an assistant, whereas a
     * `loadModel()` that fails because the appliance is unreachable would make the offline tier
     * depend on being online — the exact failure the on-device path exists to avoid.
     */
    fun buildProviders(client: CompanionIntentClient): List<ToolProvider> {
        val manifest =
            try {
                client.fetchManifest()
            } catch (e: Exception) {
                Log.w(TAG, "Intent catalog unavailable; the local model will run without tools", e)

                return emptyList()
            }

        val executable = manifest.executable()

        if (manifest.tier == null) {
            // Pre-1.2.0 appliance: it ignored `?tier=local`, so no ruling came back and
            // `executable()` is empty. Say so explicitly — silently toolless is indistinguishable
            // from "this appliance has no intents", which sends you debugging the wrong thing.
            Log.w(
                TAG,
                "Appliance did not return per-tier dispatch rulings (manifest ${manifest.version}); " +
                    "no tools will be offered. Upgrade CI-Server to 1.2.0+ for on-device tool calling.",
            )
        } else {
            Log.i(TAG, "Offering ${executable.size} of ${manifest.intents.size} intents to the local model")
        }

        return executable.map { tool(IntentTool(it, client)) }
    }
}

/**
 * One published intent, exposed to the model as an OpenAI-style function.
 *
 * The argument schema is passed through from the catalog untouched, so the model is constrained by
 * the same JSON Schema the appliance validates against — rather than a hand-copied Kotlin
 * approximation that can drift from it.
 */
internal class IntentTool(
    private val intent: ManifestIntent,
    private val client: CompanionIntentClient,
) : OpenApiTool {

    override fun getToolDescriptionJsonString(): String =
        JSONObject()
            .put("name", intent.tool)
            .put("description", buildDescription())
            .put("parameters", intent.parameters)
            .toString()

    override fun execute(paramsJsonString: String): String {
        val arguments =
            try {
                if (paramsJsonString.isBlank()) JSONObject() else JSONObject(paramsJsonString)
            } catch (e: Exception) {
                return errorPayload("Arguments were not valid JSON: ${e.message}")
            }

        // Re-check the ruling at call time rather than trusting that only executable intents were
        // registered. Registration and invocation are separated by the whole lifetime of a loaded
        // model, and this is the last chokepoint before a destructive or third-party call would
        // actually leave the device.
        val ruling = intent.dispatch
        if (ruling == null || !ruling.isExecutable) {
            return errorPayload(ruling?.explanation ?: "\"${intent.name}\" may not run on this device")
        }

        return try {
            client.callTool(intent.tool, arguments)
        } catch (e: Exception) {
            // Handed back as content, not thrown: the model can then tell the user what failed or
            // pick a different intent, whereas an exception aborts the whole generation.
            errorPayload(e.message ?: "The appliance could not run \"${intent.name}\"")
        }
    }

    private fun buildDescription(): String =
        if (intent.title.isNotEmpty() && intent.title != intent.description) {
            "${intent.title}. ${intent.description}"
        } else {
            intent.description
        }

    private fun errorPayload(message: String): String = JSONObject().put("error", message).toString()
}
