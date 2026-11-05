const menuButton = document.querySelector('.menu-toggle');
const navigation = document.querySelector('#navigation');

if (menuButton && navigation) {
  const mobile = window.matchMedia('(max-width: 760px)');
  const setMenu = (open) => {
    menuButton.setAttribute('aria-expanded', String(open));
    navigation.hidden = mobile.matches && !open;
  };
  menuButton.hidden = false;
  setMenu(false);
  menuButton.addEventListener('click', () => {
    setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
  });
  navigation.addEventListener('click', (event) => {
    if (event.target.closest('a')) setMenu(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobile.matches && !navigation.hidden) {
      setMenu(false);
      menuButton.focus();
    }
  });
  mobile.addEventListener('change', () => setMenu(false));
}
