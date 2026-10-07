package com.companionintelligence.app;

import android.os.Bundle;
import com.companionintelligence.localhub.AuthTabSession;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Before super.onCreate: the Auth Tab launcher has to exist before the
        // activity is started, and FcmStatusPlugin has to be on the builder
        // before BridgeActivity.load() freezes it. See the registration test.
        AuthTabSession.register(this);
        registerPlugin(FcmStatusPlugin.class);
        super.onCreate(savedInstanceState);

        // After super.onCreate: BridgeActivity.load() has built the bridge and its
        // WebView by now. Without a DownloadListener the WebView discards every
        // download (see WebViewDownloads).
        if (bridge != null && bridge.getWebView() != null) {
            WebViewDownloads.attach(this, bridge.getWebView());
        }
    }
}
