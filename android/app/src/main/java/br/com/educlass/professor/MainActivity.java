package br.com.educlass.professor;

import android.app.Activity;
import android.app.PrintManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Aplicativo EduClass 2.0 inteiramente offline. */
public final class MainActivity extends Activity {
    private static final int PICK_PHOTO = 6101;
    private static final int SAVE_DOCUMENT = 6102;
    private WebView webView;
    private android.webkit.ValueCallback<Uri[]> photoCallback;
    private String pendingContents;
    private String pendingFilename;
    private String pendingMime;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(16,29,53));
        getWindow().setNavigationBarColor(Color.WHITE);
        getWindow().getDecorView().setSystemUiVisibility(
                android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(245,247,251));
        setContentView(webView);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setSupportZoom(false);
        webView.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"file".equals(uri.getScheme()) ||
                       !uri.toString().startsWith("file:///android_asset/");
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v,
                    android.webkit.ValueCallback<Uri[]> callback,
                    FileChooserParams chooserParams) {
                if (photoCallback != null) photoCallback.onReceiveValue(null);
                photoCallback = callback;
                try {
                    startActivityForResult(chooserParams.createIntent(), PICK_PHOTO);
                    return true;
                } catch (Exception ex) {
                    photoCallback = null;
                    Toast.makeText(MainActivity.this, "Não foi possível abrir os arquivos.",
                                   Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        webView.addJavascriptInterface(new EduClassBridge(), "AndroidBridge");
        webView.loadUrl("file:///android_asset/index.html");
    }

    public final class EduClassBridge {
        @JavascriptInterface public void saveFile(String filename, String content, String mime) {
            runOnUiThread(() -> {
                if (pendingContents != null) {
                    Toast.makeText(MainActivity.this, "Conclua o salvamento anterior.",
                                   Toast.LENGTH_SHORT).show();
                    return;
                }
                pendingFilename = filename.replaceAll("[^a-zA-Z0-9À-ÿ_.-]", "_");
                pendingMime = mime;
                pendingContents = content;
                try {
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(pendingMime);
                    i.putExtra(Intent.EXTRA_TITLE, pendingFilename);
                    startActivityForResult(i, SAVE_DOCUMENT);
                } catch (Exception ex) {
                    resetDocument();
                    Toast.makeText(MainActivity.this, "Erro ao abrir o salvamento.",
                                   Toast.LENGTH_LONG).show();
                }
            });
        }
        @JavascriptInterface public void printReport() {
            runOnUiThread(() -> {
                PrintManager p = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                p.print("EduClass - Boletim",
                    webView.createPrintDocumentAdapter("Boletim EduClass"),
                    new PrintAttributes.Builder().build());
            });
        }
    }
    private void resetDocument() {
        pendingFilename = null;
        pendingMime = null;
        pendingContents = null;
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == PICK_PHOTO) {
            if (photoCallback != null) {
                Uri[] selection = result == RESULT_OK ?
                    WebChromeClient.FileChooserParams.parseResult(result, data) : null;
                photoCallback.onReceiveValue(selection);
                photoCallback = null;
            }
        } else if (request == SAVE_DOCUMENT) {
            if (result == RESULT_OK && data != null && data.getData() != null &&
                pendingContents != null) {
                try (OutputStream stream =
                     getContentResolver().openOutputStream(data.getData())) {
                    if (stream == null) throw new IllegalStateException("No stream");
                    stream.write(pendingContents.getBytes(StandardCharsets.UTF_8));
                    Toast.makeText(this, "Arquivo salvo!", Toast.LENGTH_LONG).show();
                } catch (Exception ex) {
                    Toast.makeText(this, "Não foi possível salvar.",
                                   Toast.LENGTH_LONG).show();
                }
            }
            resetDocument();
        }
    }
    @Override public void onBackPressed() {
        if (webView == null) { super.onBackPressed(); return; }
        webView.evaluateJavascript(
            "window.educlassHandleBack ? window.educlassHandleBack() : false",
            value -> { if (!"true".equals(value)) MainActivity.super.onBackPressed(); });
    }
    @Override protected void onDestroy() {
        if (photoCallback != null) { photoCallback.onReceiveValue(null); photoCallback = null; }
        if (webView != null) { webView.destroy(); webView = null; }
        super.onDestroy();
    }
}
