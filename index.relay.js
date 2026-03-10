// Global polyfills needed by GramJS before any other imports
import 'react-native-get-random-values';
import {Buffer} from 'buffer';
global.Buffer = Buffer;
if (typeof globalThis !== 'undefined') globalThis.Buffer = Buffer;

import {AppRegistry} from 'react-native';
import RelayApp from './RelayApp';

AppRegistry.registerComponent('NoHackRelay', () => RelayApp);
