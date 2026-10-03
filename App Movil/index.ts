import { registerRootComponent } from 'expo';

import App from './App';

// En web, declarar el idioma evita que Chrome "traduzca" la app (p. ej. PV -> "Fotovoltaica").
if (typeof document !== 'undefined') {
  document.documentElement.lang = 'es';
  document.documentElement.setAttribute('translate', 'no');
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
