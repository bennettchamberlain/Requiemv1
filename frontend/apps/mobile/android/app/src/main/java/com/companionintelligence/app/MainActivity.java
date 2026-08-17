package com.companionintelligence.app;

import android.os.Bundle;
import com.companionintelligence.app.localllm.LocalLlmPlugin;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Capacitor plugins are not auto-discovered on Android (unlike iOS) — must
    // register before super.onCreate(), which is what instantiates the Bridge.
    registerPlugin(LocalLlmPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
