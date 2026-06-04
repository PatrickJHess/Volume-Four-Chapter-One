// _static/open_new_tab.js
(function() {
    "use strict";

    var fixLinks = function() {
        // 1. Handle Main Content Links
        var currentRepo = window.location.pathname.split('/').filter(Boolean)[0];
        var links = document.getElementsByTagName('a');
        
        for (var i = 0; i < links.length; i++) {
            var link = links[i];
            if (link.hostname) {
                var linkRepo = link.pathname.split('/').filter(Boolean)[0];
                
                if (link.hostname !== window.location.hostname || (linkRepo && linkRepo !== currentRepo)) {
                    if (!link.target || !link.target.startsWith('_blank_')) {
                        link.target = "_blank_" + Math.random().toString(36).substring(2, 9);
                        link.rel = 'noopener noreferrer';
                        link.title = "Opens in a new tab"; // Added here
                    }
                }
            }
        }

        // 2. Handle Sidebar External Links
        var sidebarLinks = document.querySelectorAll('.bd-sidebar .nav-link[href^="http"]');
        sidebarLinks.forEach(function(sLink) {
            if (!sLink.getAttribute('target')) {
                sLink.setAttribute('target', '_blank_' + Math.random().toString(36).substring(2, 9));
                sLink.setAttribute('rel', 'noopener noreferrer');
                sLink.setAttribute('title', 'Opens in a new tab'); // Added here
            }
        });
    };
// 3. Handle Dynamic Colab Badge Links (NEW)
        var colabLinks = document.querySelectorAll('.colab-sticky-link a');
        colabLinks.forEach(function(cLink) {
            // Get current filename and swap .html for .ipynb
            var pathParts = window.location.pathname.split('/');
            var fileName = pathParts[pathParts.length - 1] || "index.html";
            var ipynbName = fileName.replace(".html", ".ipynb");
            
            // Build the specific Colab URL
            var repoBase = "https://colab.research.google.com/github/PatrickJHess/Vol-3-Chap-1/blob/master/";
            var finalUrl = repoBase + ipynbName;

            // Only update if it hasn't been set yet to avoid infinite logic loops
            if (cLink.getAttribute('href') !== finalUrl) {
                cLink.setAttribute('href', finalUrl);
                cLink.setAttribute('target', '_blank');
                cLink.setAttribute('rel', 'noopener noreferrer');
            }
        });
    };
    // Initial Execution
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", fixLinks);
    } else {
        fixLinks();
    }

    // Check periodically for late-loading elements (like sidebar updates)
    var attempts = 0;
    var checkExist = setInterval(function() {
        fixLinks();
        attempts++;
        if (attempts > 10) clearInterval(checkExist); 
    }, 500);

})(); // This is the closure you assumed—it wraps everything above.

document.addEventListener("DOMContentLoaded", function() {
    // Find all links that point to mybinder.org
    const binderLinks = document.querySelectorAll('a[href*="mybinder.org"]');

    binderLinks.forEach(function(link) {
        link.addEventListener("click", function(event) {
            // Trigger the pop-up warning
            const userConfirmed = confirm("You are about to leave this site to access an interactive environment on Binder (an external website). Do you wish to continue?");
            
            // If the user clicks "Cancel", stop the redirect
            if (!userConfirmed) {
                event.preventDefault(); 
            }
        });
    });
});
