// Runs in <head>, before the page is drawn. The website opens on the front
// page, but the HTML starts on the "Looking for your capture device" screen
// and renderer.js can take a moment to load. This shows the front page from
// the very first frame. renderer.js removes the class once it takes over.
if (!window.portplay && location.hash !== '#app') {
  document.documentElement.classList.add('boot-landing')
}
