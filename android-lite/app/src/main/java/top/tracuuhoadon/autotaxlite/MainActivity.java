package top.tracuuhoadon.autotaxlite;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.SafeBrowsingResponse;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

public final class MainActivity extends Activity {
    private static final String LITE_URL = "https://tracuuhoadon.top/lite/";
    private static final int FILE_REQUEST = 1027;
    private WebView browser;
    private ValueCallback<Uri[]> pendingFileChooser;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        browser = new WebView(this);
        browser.setBackgroundColor(0xFF0A1018);
        browser.setOverScrollMode(View.OVER_SCROLL_NEVER);
        setContentView(browser);
        WebView.setWebContentsDebuggingEnabled(false);

        WebSettings settings = browser.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSafeBrowsingEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, false);

        browser.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri address = request.getUrl();
                if (address == null) return true;
                String scheme = address.getScheme();
                if (!"https".equalsIgnoreCase(scheme)) return true;
                String host = address.getHost();
                if ("tracuuhoadon.top".equalsIgnoreCase(host)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, address));
                } catch (Exception ignored) {
                    Toast.makeText(MainActivity.this, "Không mở được liên kết bên ngoài.", Toast.LENGTH_SHORT).show();
                }
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                        "Không tải được AutoTax Lite. Kiểm tra kết nối mạng rồi mở lại.",
                        Toast.LENGTH_LONG).show();
                }
            }
        });

        browser.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                                         FileChooserParams params) {
                if (pendingFileChooser != null) pendingFileChooser.onReceiveValue(null);
                pendingFileChooser = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_REQUEST);
                    return true;
                } catch (Exception error) {
                    pendingFileChooser = null;
                    callback.onReceiveValue(null);
                    Toast.makeText(MainActivity.this, "Thiết bị không có ứng dụng chọn tệp.", Toast.LENGTH_SHORT).show();
                    return true;
                }
            }
        });

        if (state == null) browser.loadUrl(LITE_URL);
        else browser.restoreState(state);
    }

    @Override protected void onSaveInstanceState(Bundle outState) {
        if (browser != null) browser.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != FILE_REQUEST || pendingFileChooser == null) return;
        Uri[] resultUris = WebChromeClient.FileChooserParams.parseResult(result, data);
        pendingFileChooser.onReceiveValue(resultUris);
        pendingFileChooser = null;
    }

    @Override public void onBackPressed() {
        if (browser != null && browser.canGoBack()) browser.goBack();
        else super.onBackPressed();
    }

    @Override protected void onDestroy() {
        if (pendingFileChooser != null) {
            pendingFileChooser.onReceiveValue(null);
            pendingFileChooser = null;
        }
        if (browser != null) {
            browser.stopLoading();
            browser.destroy();
            browser = null;
        }
        super.onDestroy();
    }
}
