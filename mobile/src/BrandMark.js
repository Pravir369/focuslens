import React from 'react';
import { Image } from 'react-native';

// The FocusLens mark. React Native has no inline SVG without an extra native
// dependency, and the transparent gradient export already ships with the app
// for the splash screen, so the lockup reuses that single source of truth.
const MARK = require('../assets/splash-icon.png');

export function BrandMark({ size = 28 }) {
  return <Image source={MARK} accessibilityIgnoresInvertColors resizeMode="contain"
    style={{ width: size, height: size }} />;
}
