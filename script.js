(() => {
  const sideNav = document.getElementById('sideNav');
  const globalMenuBtn = document.getElementById('globalMenuBtn');
  const closeNav = document.getElementById('closeNav');

  function handleNavClick(e) {
    const target = e.target.closest('[data-nav]');
    if (!target) return;
    
    // Handle Effects menu toggle
    if (target.classList.contains('nav-group-toggle')) {
      e.preventDefault();
      const parentGroup = target.closest('.nav-group');
      if (parentGroup) {
        parentGroup.classList.toggle('open');
      }
      return;
    }

    const href = target.getAttribute('href');

    // Handle explicit navigation to index.html (with or without hash) from any page
    // This forces a full page reload
    if (href && href.includes('index.html')) {
      e.preventDefault(); // Prevent default behavior to handle manually
      sideNav.classList.remove('open');
      window.location.href = href; // Force full page reload
      return;
    }

    // Only prevent default and handle as SPA if it's an internal hash link on the main index page
    if (href && href.startsWith('#') && (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '')) {
      e.preventDefault();
      const name = target.getAttribute('data-nav');
      document.querySelectorAll('.route').forEach(r => r.classList.remove('active'));
      const el = document.getElementById(name);
      if (el) el.classList.add('active');
    }

    // For any other links (like pages/*.html from pages/other.html), let browser handle by default
    // No explicit preventDefault needed here, as it's already handled above if needed.
    sideNav.classList.remove('open');
  }
  document.addEventListener('click', handleNavClick);
  globalMenuBtn.addEventListener('click', () => sideNav.classList.add('open'));
  closeNav.addEventListener('click', () => sideNav.classList.remove('open'));

  // Handle hover for nav-group on non-touch devices
  const navGroups = document.querySelectorAll('.nav-group');
  if (window.matchMedia('(hover: hover)').matches) { // Only enable hover for devices that support it
    navGroups.forEach(group => {
      group.addEventListener('mouseover', () => group.classList.add('open'));
      group.addEventListener('mouseout', () => group.classList.remove('open'));
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (window.location.pathname.endsWith('index.html') || window.location.pathname === '/' || window.location.pathname === '') { // Only run if on the main index page
      const initialRoute = window.location.hash ? window.location.hash.substring(1) : 'home';
      document.querySelectorAll('.route').forEach(r => r.classList.remove('active'));
      const el = document.getElementById(initialRoute);
      if (el) el.classList.add('active');
    }
  });
})();