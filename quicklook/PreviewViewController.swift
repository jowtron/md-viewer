import Cocoa
import WebKit
import QuickLookUI

@objc(PreviewViewController)
class PreviewViewController: NSViewController, QLPreviewingController, WKNavigationDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var pendingHandler: ((Error?) -> Void)?

    override func loadView() {
        let container = NSView(frame: NSRect(x: 0, y: 0, width: 800, height: 600))
        let config = WKWebViewConfiguration()
        let userContent = WKUserContentController()
        userContent.add(self, name: "qlLog")
        // Bridge console.* into a native handler so we can see JS errors in
        // the system log when debugging the extension.
        let bridge = """
        (function(){
          ['log','warn','error','info'].forEach(function(level){
            var orig = console[level];
            console[level] = function(){
              try {
                var msg = Array.from(arguments).map(function(a){
                  if (a && a.stack) return a.stack;
                  if (typeof a === 'object') { try { return JSON.stringify(a); } catch(e) { return String(a); } }
                  return String(a);
                }).join(' ');
                window.webkit.messageHandlers.qlLog.postMessage(level + ': ' + msg);
              } catch(e) {}
              orig.apply(console, arguments);
            };
          });
          window.addEventListener('error', function(e){
            window.webkit.messageHandlers.qlLog.postMessage('uncaught: ' + (e.error && e.error.stack || e.message));
          });
        })();
        """
        userContent.addUserScript(WKUserScript(source: bridge,
                                               injectionTime: .atDocumentStart,
                                               forMainFrameOnly: true))
        config.userContentController = userContent
        webView = WKWebView(frame: container.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        container.addSubview(webView)
        self.view = container
    }

    func userContentController(_ userContentController: WKUserContentController,
                                didReceive message: WKScriptMessage) {
        NSLog("[QLPreview-JS] %@", String(describing: message.body))
    }

    func preparePreviewOfFile(at url: URL, completionHandler handler: @escaping (Error?) -> Void) {
        do {
            let markdown = try String(contentsOf: url, encoding: .utf8)
            guard let resourceURL = Bundle.main.resourceURL else {
                handler(NSError(domain: "MdViewerQuickLook", code: 1,
                                userInfo: [NSLocalizedDescriptionKey: "Missing resources"]))
                return
            }
            // Inline everything — WKWebView's file:// CORS policy blocks
            // external <script type="module" src="..."> loads, so we splat
            // marked + CSS directly into the page.
            let css = (try? String(contentsOf: resourceURL.appendingPathComponent("preview.css"), encoding: .utf8)) ?? ""
            // marked.esm.js ends with `export{...,g as marked,...}` — drop the
            // export line so the script can run as a plain (non-module) <script>,
            // then expose `marked` globally. ES modules don't execute in a
            // file:// loadHTMLString origin in WKWebView; plain scripts do.
            var markedJS = (try? String(contentsOf: resourceURL.appendingPathComponent("marked.esm.js"), encoding: .utf8)) ?? ""
            if let exportRange = markedJS.range(of: "export{", options: .backwards) {
                markedJS = String(markedJS[..<exportRange.lowerBound])
            }
            markedJS += "\nwindow.marked = g;\n"
            let jsonData = try JSONSerialization.data(withJSONObject: markdown, options: [.fragmentsAllowed])
            let mdJSON = String(data: jsonData, encoding: .utf8) ?? "\"\""

            let html = """
            <!doctype html>
            <html lang="en">
            <head>
            <meta charset="utf-8">
            <style>
            \(css)
            body { display: block; height: auto; }
            #content { padding: 24px 32px; max-width: none; }
            </style>
            <script>
            document.documentElement.setAttribute("data-theme",
              window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
            </script>
            </head>
            <body>
            <div id="content" class="markdown-body"></div>
            <script>
            \(markedJS)
            </script>
            <script>
            marked.setOptions({ gfm: true, breaks: false });
            document.getElementById("content").innerHTML = marked.parse(\(mdJSON));
            </script>
            </body>
            </html>
            """

            pendingHandler = handler
            webView.loadHTMLString(html, baseURL: resourceURL)
        } catch {
            handler(error)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pendingHandler?(nil)
        pendingHandler = nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        pendingHandler?(error)
        pendingHandler = nil
    }

    func webView(_ webView: WKWebView,
                 decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if navigationAction.navigationType == .linkActivated, let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }
}
