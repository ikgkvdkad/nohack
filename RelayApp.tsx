import React, {useState, useEffect} from 'react';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import RelayMainScreen from './src/relay/screens/RelayMainScreen';
import TelegramSetupScreen from './src/relay/screens/TelegramSetupScreen';
import {getTelegramCredentials} from './src/relay/store/relayStore';

export type RelayStackParamList = {
  TelegramSetup: undefined;
  RelayMain: undefined;
};

const Stack = createNativeStackNavigator<RelayStackParamList>();

export default function RelayApp() {
  const [initialRoute, setInitialRoute] = useState<keyof RelayStackParamList | null>(null);

  useEffect(() => {
    getTelegramCredentials().then(creds => {
      setInitialRoute(creds ? 'RelayMain' : 'TelegramSetup');
    });
  }, []);

  if (!initialRoute) return null; // loading

  return (
    <GestureHandlerRootView style={{flex: 1}}>
      <SafeAreaProvider>
        <NavigationContainer>
          <Stack.Navigator
            initialRouteName={initialRoute}
            screenOptions={{headerShown: false, animation: 'fade'}}>
            <Stack.Screen name="TelegramSetup" component={TelegramSetupScreen} />
            <Stack.Screen name="RelayMain" component={RelayMainScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
