import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Pattern, Circle, Path, Rect } from 'react-native-svg';
import { palette } from './theme';

export function PaperTexture() {
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" accessible={false}>
      <Defs><Pattern id="paper-grain" width={56} height={56} patternUnits="userSpaceOnUse">
        <Circle cx={7} cy={12} r={0.6} fill="#AF9670" opacity={0.17} />
        <Circle cx={35} cy={40} r={0.5} fill="#AF9670" opacity={0.14} />
        <Path d="M20 6l2 1 M44 22l3-.5 M10 46l2 .5" stroke="#BFA681" strokeWidth={0.5} opacity={0.2} />
      </Pattern></Defs>
      <Rect width="100%" height="100%" fill="url(#paper-grain)" />
    </Svg>
  </View>;
}

export function SketchBorder() {
  return <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
    <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none" accessible={false}>
      <Path d="M7 2.5 Q42 1.5 92 2.8 Q98 3 97.6 10 L98 90 Q98 97 91 97.5 Q49 98.2 8 97 Q2.3 97 2.8 90 L2 10 Q2.2 3 7 2.5Z" fill="none" stroke={palette.line} strokeWidth={0.85} vectorEffect="non-scaling-stroke" opacity={0.7} />
    </Svg>
  </View>;
}
