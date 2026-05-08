// PostHog — marketing site (ok2eat.com)
// Same project (382774) as the iOS + web apps so marketing-funnel data merges
// with product data in the same dashboards. The `platform` super-property is
// set to "marketing" here vs "web" in the app, so cohort splits are clean.
//
// Loaded on every marketing page (ok2eat.html, /blog/, /shelf-life/, /privacy/)
// to track:
//   - $pageview (auto) — gives us referrer, so we can see Google / X / direct
//   - shelf_life_search — typed query in the directory's search box
//   - shelf_life_item_view — auto-fires on /shelf-life/{slug}.html with the slug
//   - homepage_shelf_life_search — search submitted from the homepage section
//   - outbound_app_click — link click to app.ok2eat.com or the App Store
//
// All instrumentation is best-effort and never throws — ad-blockers and
// privacy extensions silently break things and that's fine.

(function () {
  // 1) Load posthog-js from PostHog's CDN (the array shim is the official
  //    snippet — queues calls until the real lib finishes loading).
  !function (t, e) {
    var o, n, p, r;
    e.__SV ||
      ((window.posthog = e),
        (e._i = []),
        (e.init = function (i, s, a) {
          function g(t, e) {
            var o = e.split(".");
            2 == o.length && ((t = t[o[0]]), (e = o[1])),
              (t[e] = function () {
                t.push([e].concat(Array.prototype.slice.call(arguments, 0)));
              });
          }
          ((p = t.createElement("script")).type = "text/javascript"),
            (p.crossOrigin = "anonymous"),
            (p.async = !0),
            (p.src =
              s.api_host.replace(".i.posthog.com", "-assets.i.posthog.com") +
              "/static/array.js"),
            (r = t.getElementsByTagName("script")[0]).parentNode.insertBefore(p, r);
          var u = e;
          for (
            void 0 !== a ? (u = e[a] = []) : (a = "posthog"),
              u.people = u.people || [],
              u.toString = function (t) {
                var e = "posthog";
                return "posthog" !== a && (e += "." + a), t || (e += " (stub)"), e;
              },
              u.people.toString = function () {
                return u.toString(1) + ".people (stub)";
              },
              o =
                "init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug getPageViewId".split(
                  " "
                ),
              n = 0;
            n < o.length;
            n++
          )
            g(u, o[n]);
          e._i.push([i, s, a]);
        }),
        (e.__SV = 1));
  })(document, window.posthog || []);

  // 2) Initialize. Same project key as iOS + web app.
  posthog.init("phc_szxhjw2eQmYYhNGicX3kmNXxdz47Sj7evqx5Quqw8dTY", {
    api_host: "https://us.i.posthog.com",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false, // keep the dashboard clean — explicit events only
    // anonymous visitors don't bloat the user count until sign-in
    person_profiles: "identified_only",
  });

  // 3) Tag every event with platform=marketing so cohort splits stay clean.
  posthog.register({ platform: "marketing" });

  // 4) Custom events — wired up after DOMContentLoaded so we don't fight
  //    other inline scripts.
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var path = window.location.pathname;

    // --- Per-item shelf-life pages: /shelf-life/{slug}.html ---
    // Captures slug + h1 + category so we can rank "what items get viewed
    // most from organic search" in PostHog.
    if (/^\/shelf-life\/.+\.html$/.test(path)) {
      var slug = path.replace(/^\/shelf-life\//, "").replace(/\.html$/, "");
      var h1 = document.querySelector("h1");
      var category = (
        document.querySelector('[data-category]') || {}
      ).getAttribute &&
        document.querySelector('[data-category]').getAttribute("data-category");
      posthog.capture("shelf_life_item_view", {
        slug: slug,
        title: h1 ? h1.textContent.trim() : null,
        category: category || null,
      });
    }

    // --- Shelf-life directory: /shelf-life/ ---
    // Search input is debounced. We only capture queries length>=2 to avoid
    // single-character noise; and only on a 600ms quiet period to merge
    // mid-typing keystrokes into one event.
    if (path === "/shelf-life/" || path === "/shelf-life") {
      var input = document.getElementById("shelf-search");
      if (input) {
        var debounceTimer = null;
        input.addEventListener("input", function () {
          clearTimeout(debounceTimer);
          debounceTimer = setTimeout(function () {
            var q = (input.value || "").trim();
            if (q.length < 2) return;
            posthog.capture("shelf_life_search", {
              query: q.toLowerCase(),
              length: q.length,
            });
          }, 600);
        });
      }
    }

    // --- Homepage shelf-life search box ---
    // The homepage <form action="/shelf-life/"> in the "How long does
    // {anything} last?" section. Captures the query at submit time.
    if (path === "/" || path === "/index.html") {
      var hpForm = document.querySelector('form[action="/shelf-life/"]');
      if (hpForm) {
        hpForm.addEventListener("submit", function () {
          var nameField = hpForm.querySelector('[name="q"]');
          var q = nameField ? (nameField.value || "").trim() : "";
          posthog.capture("homepage_shelf_life_search", {
            query: q.toLowerCase(),
            length: q.length,
          });
        });
      }
    }

    // --- Outbound clicks: app.ok2eat.com / App Store ---
    // Lets us measure conversion from marketing pages → web app or App Store.
    document.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("a");
      if (!a) return;
      var href = a.getAttribute("href") || "";
      if (!href) return;
      var event = null;
      if (/^https?:\/\/app\.ok2eat\.com/.test(href)) event = "outbound_web_app_click";
      else if (/apps\.apple\.com.*ok2eat/.test(href)) event = "outbound_appstore_click";
      else if (/^https?:\/\/(www\.)?fsis\.usda\.gov/.test(href)) event = "outbound_usda_click";
      if (event) {
        posthog.capture(event, {
          href: href,
          source_path: window.location.pathname,
        });
      }
    });
  });
})();
