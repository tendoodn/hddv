package top.tracuuhoadon.autotaxlite;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

public final class MainActivity extends Activity {
 private static final String SITE="https://tracuuhoadon.top";
 private static final int CHOOSE_FILE=1027;
 private boolean fullEdition; private WebView web; private ValueCallback<Uri[]> fileChooser;
 private int dp(float value){return Math.round(value*getResources().getDisplayMetrics().density);}
 private TextView text(String value,int size,int color){TextView t=new TextView(this);t.setText(value);t.setTextColor(color);t.setTextSize(size);t.setGravity(Gravity.CENTER_VERTICAL);return t;}
 private void load(String path){if(web!=null)web.loadUrl(SITE+path);}
 private TextView action(String caption,String url){TextView btn=text(caption,12,Color.WHITE);btn.setGravity(Gravity.CENTER);btn.setMinHeight(dp(46));btn.setContentDescription("Mở "+caption);btn.setOnClickListener(v->load(url));btn.setLayoutParams(new LinearLayout.LayoutParams(0,dp(51),1f));return btn;}
 @Override public void onCreate(Bundle saved){
  super.onCreate(saved);fullEdition=getPackageName().endsWith(".full");
  getWindow().setStatusBarColor(Color.rgb(6,16,25));getWindow().setNavigationBarColor(Color.rgb(6,16,25));
  if(Build.VERSION.SDK_INT>=30)getWindow().setDecorFitsSystemWindows(false);WebView.setWebContentsDebuggingEnabled(false);
  LinearLayout shell=new LinearLayout(this);shell.setOrientation(LinearLayout.VERTICAL);shell.setBackgroundColor(Color.rgb(7,18,29));
  shell.setOnApplyWindowInsetsListener((view,insets)->{int top,bottom,left,right;if(Build.VERSION.SDK_INT>=30){Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());top=safe.top;bottom=safe.bottom;left=safe.left;right=safe.right;}else{top=insets.getSystemWindowInsetTop();bottom=insets.getSystemWindowInsetBottom();left=insets.getSystemWindowInsetLeft();right=insets.getSystemWindowInsetRight();}view.setPadding(left,top+dp(12),right,bottom+dp(4));return insets;});
  setContentView(shell);shell.requestApplyInsets();
  LinearLayout toolbar=new LinearLayout(this);toolbar.setGravity(Gravity.CENTER_VERTICAL);toolbar.setOrientation(LinearLayout.HORIZONTAL);toolbar.setPadding(dp(12),dp(5),dp(12),dp(5));toolbar.setBackgroundColor(Color.rgb(11,29,43));shell.addView(toolbar,new LinearLayout.LayoutParams(-1,dp(56)));
  ImageView logo=new ImageView(this);logo.setImageResource(R.drawable.autotax_icon);toolbar.addView(logo,new LinearLayout.LayoutParams(dp(37),dp(37)));
  LinearLayout heading=new LinearLayout(this);heading.setOrientation(LinearLayout.VERTICAL);heading.setPadding(dp(9),0,0,0);toolbar.addView(heading,new LinearLayout.LayoutParams(0,-2,1f));
  TextView title=text(fullEdition?"AutoTax Đầy đủ":"AutoTax Lite",17,Color.WHITE);title.setTypeface(null,android.graphics.Typeface.BOLD);heading.addView(title);heading.addView(text("V1.2.2 · Ứng dụng AutoTax",11,Color.rgb(122,216,202)));
  TextView reload=text("↻",25,Color.rgb(124,240,202));reload.setGravity(Gravity.CENTER);reload.setContentDescription("Tải lại trang");reload.setOnClickListener(v->{if(web!=null)web.reload();});toolbar.addView(reload,new LinearLayout.LayoutParams(dp(44),dp(44)));
  web=new WebView(this);web.setBackgroundColor(Color.rgb(10,16,24));web.setOverScrollMode(android.view.View.OVER_SCROLL_NEVER);shell.addView(web,new LinearLayout.LayoutParams(-1,0,1f));
  WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);settings.setJavaScriptCanOpenWindowsAutomatically(false);settings.setSupportMultipleWindows(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.O)settings.setSafeBrowsingEnabled(true);settings.setMediaPlaybackRequiresUserGesture(true);settings.setBuiltInZoomControls(false);settings.setDisplayZoomControls(false);settings.setUseWideViewPort(true);settings.setLoadWithOverviewMode(true);settings.setCacheMode(WebSettings.LOAD_DEFAULT);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){if(!request.isForMainFrame())return false;Uri url=request.getUrl();if(url==null||!"https".equalsIgnoreCase(url.getScheme()))return true;String host=url.getHost();if("tracuuhoadon.top".equalsIgnoreCase(host))return false;try{startActivity(new Intent(Intent.ACTION_VIEW,url));}catch(Exception ex){Toast.makeText(MainActivity.this,"Không mở được liên kết ngoài.",Toast.LENGTH_SHORT).show();}return true;}@Override public void onReceivedError(WebView view,WebResourceRequest request,WebResourceError error){if(request.isForMainFrame())Toast.makeText(MainActivity.this,"Không tải được AutoTax. Kiểm tra Internet rồi thử lại.",Toast.LENGTH_LONG).show();}});
  web.setWebChromeClient(new WebChromeClient(){@Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){if(fileChooser!=null)fileChooser.onReceiveValue(null);fileChooser=callback;try{startActivityForResult(params.createIntent(),CHOOSE_FILE);return true;}catch(Exception ex){fileChooser=null;callback.onReceiveValue(null);Toast.makeText(MainActivity.this,"Không có ứng dụng chọn tệp",Toast.LENGTH_SHORT).show();return true;}}});
  LinearLayout nav=new LinearLayout(this);nav.setGravity(Gravity.CENTER_VERTICAL);nav.setBackgroundColor(Color.rgb(13,44,59));shell.addView(nav,new LinearLayout.LayoutParams(-1,dp(51)));nav.addView(action("Tra cứu",fullEdition?"/":"/lite/"));nav.addView(action("Tra MST","/tracuumst/"));nav.addView(action("Tài khoản","/user/"));if(fullEdition)nav.addView(action("Tiện ích","/gioi-thieu/"));
  if(saved==null)load(fullEdition?"/":"/lite/");else web.restoreState(saved);
 }
 @Override protected void onSaveInstanceState(Bundle out){if(web!=null)web.saveState(out);super.onSaveInstanceState(out);}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=CHOOSE_FILE||fileChooser==null)return;fileChooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result,data));fileChooser=null;}
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){if(fileChooser!=null){fileChooser.onReceiveValue(null);fileChooser=null;}if(web!=null){web.stopLoading();web.destroy();web=null;}super.onDestroy();}
}
