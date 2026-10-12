/* Gated document page. Generic: this file holds no wording and names no one. The page names a document in
   <body data-doc="...">; after sign-in the document arrives from the API and replaces this page, so its own
   script, its print layout and its in-page links work as written. Nothing is shown without the password. */
(function () {
  "use strict";
  var R = window.RAM;
  var name = document.body.getAttribute("data-doc") || "";
  function fail(text) {
    var a = document.getElementById("app");
    if (a) { a.hidden = false; a.textContent = text; }
  }
  R.gate(function () {
    R.api("/plan/doc/" + encodeURIComponent(name)).then(function (r) {
      if (!r.ok) throw new Error("the server answered " + r.status);
      return r.text();
    }).then(function (html) {
      var hash = location.hash;
      document.open(); document.write(html); document.close();
      if (hash && hash.length > 1) {
        setTimeout(function () { var el = document.getElementById(hash.slice(1)); if (el) el.scrollIntoView(); }, 200);
      }
    }).catch(function (e) {
      if (e && e.message !== "signed out") fail("This page could not be opened: " + (e.message || "no answer"));
    });
  });
})();
