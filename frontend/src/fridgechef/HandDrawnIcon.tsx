import React from 'react';
import Svg, { Path, G } from 'react-native-svg';
import { palette } from './theme';

// Slightly asymmetric curves and offset highlights keep small icons readable
// while matching the organic ink outlines of our food illustration.
const drawings: Record<string, { silhouette?: string; lines: string[] }> = {
  info: {
    silhouette: 'M27 16 Q28 27 16 28 Q3 27 4 15 Q5 3 17 4 Q27 5 27 16Z',
    lines: ['M16 14 L15.8 23 M15.8 9 L16.2 9.4'],
  },
  close: { lines: ['M8 7 Q16 15 25 25', 'M24 7 Q16 15 7 25'] },
  flask: {
    silhouette: 'M12 5 L20 5 L19 14 Q25 21 27 25 Q27 28 23 28 L8 28 Q4 28 5 25 L13 14 L12 5Z',
    lines: ['M10 5 L22 5', 'M9 22 Q16 20 23 22', 'M14 24 L15 24.2 M20 25 L21 25.2'],
  },
  fridge: {
    silhouette: 'M8 3.8 Q15 2.7 23 4 L24 27 Q17 28.6 8 27.5 Q6.6 16 8 3.8Z',
    lines: ['M8 13.4 Q16 12.5 23.4 13.6', 'M11 7.2 L11.3 10.6 M11 17 L11.2 21.5', 'M10 28 L10 29 M22 27.8 L22 29', 'M19 6 L21 6.3'],
  },
  camera: {
    silhouette: 'M4.4 10 Q4 8.4 7 8.7 L11 9 L13 5.3 Q17 4.8 20 5.6 L22 9 L26 9.4 Q28.5 9.7 27.8 13 L27.3 25 Q16 26.5 4.6 25.3 Q3.6 17 4.4 10Z',
    lines: ['M21.5 17 Q21 22.5 15.8 22.1 Q10.5 21.6 10.7 16.5 Q11.3 11.7 16.1 12 Q21 12.2 21.5 17Z', 'M24 12.5 L24.7 12.7', 'M13 15 Q14 13.9 16 14'],
  },
  plus: { lines: ['M15.8 5 Q15 16 16.3 27', 'M5 16.6 Q16 15.1 27 16'] },
  leaf: {
    silhouette: 'M7 26 Q2 9 25.6 4.4 Q30 23 7 26Z',
    lines: ['M5 28 Q13 18 22 8', 'M11 20 L10.3 13 M16 15.5 L23 16.8'],
  },
  mushroom: {
    silhouette: 'M4 17 Q5 5 15.5 4.7 Q27 4.5 28 17 Q16 20 4 17Z',
    lines: ['M12 19 L10.5 27 Q16 29 21 27 L19 19', 'M10 11 L10.4 11.2 M17 8 L17.4 8.2 M23 13 L23.4 13.2', 'M7 17 Q16 15 25 17'],
  },
  egg: {
    silhouette: 'M16 3.8 Q22 5 26.2 17.4 Q30 28 16.4 28.2 Q3 28.7 5.6 18.1 Q9 5.5 16 3.8Z',
    lines: ['M21.5 21 Q21 26 15.7 25.4 Q11 24.8 11.5 20.4 Q12 16.4 16.4 16.8 Q21 17 21.5 21Z', 'M10 14 Q10.5 11.5 12 10'],
  },
  fish: {
    silhouette: 'M8 16 Q16 5.5 27 15.5 Q18 26 8 17 L3.5 23 L4 10 L8 16Z',
    lines: ['M21 12 Q18.5 16 21 20', 'M23 15 L23.5 15.2', 'M12 13 L14 12 M12 19 L14 20'],
  },
  tomato: {
    silhouette: 'M15 10 Q26 6 27.5 19 Q28 28 16 28 Q4 29 4.5 19 Q5 9 15 10Z',
    lines: ['M16 11 L11 7 L16 8 L20 6 L19 10 L23 12 L17 12', 'M16 8 Q15 4 18 3', 'M9 16 Q7 18 8 21'],
  },
  sparkles: { lines: ['M18 4 Q17 13 26 15 Q17 16 16 25 Q15 17 7 15 Q15 13 18 4Z', 'M5 4 L5 9 M2.5 6.5 L8 6.7', 'M26 23 L26.4 29 M23.5 26 L29 26.3'] },
  check: { lines: ['M5 17 Q9 21 12 24 Q20 12 27 7'] },
  trash: {
    silhouette: 'M8 10 L9.8 27 Q17 28 23 26.8 L24.6 10',
    lines: ['M5.5 9.5 Q16 8.5 27 10', 'M12 8.7 L12.8 5 Q17 4.2 20 5 L20.5 9', 'M13 14 L13.8 23 M19 14 L19.4 23'],
  },
  bowl: {
    silhouette: 'M4.4 15 Q16 13.8 27.8 15.3 Q26 27 16 27.5 Q5.8 27 4.4 15Z',
    lines: ['M8 19 Q15 20.3 23 19', 'M12 28 L22 28.3', 'M11 4 Q7 7 11 10 M18 3 Q14 6 18 9 M24 5 Q21 7 23 10'],
  },
  book: {
    silhouette: 'M7 4.8 Q16 3.5 25 5 L24.7 27 Q16 26 7 27.3 Q5 17 7 4.8Z',
    lines: ['M10 5 Q9 16 10.3 27', 'M15 9 L21 9.5 M15 13.5 L21 13', 'M18 23 Q12 18 15.6 16.6 Q17 16 18 18 Q20 15.5 22 17.5 Q23 20 18 23Z'],
  },
  chef: {
    silhouette: 'M8 19 Q1 15 5 9 Q8 5 12 8 Q14 1 20 5 Q22 6 22 9 Q28 7 29 13 Q29 18 24 20 L23.5 27 Q16 28 8 27 L8 19Z',
    lines: ['M9 21 Q17 23 24 21', 'M12 14 L12 18 M19 13 L19.6 18'],
  },
  arrow: { lines: ['M4 16 Q16 15 27 16', 'M20 9 Q23 13 27 16 Q22 19 20 23'] },
  clock: {
    silhouette: 'M27 16 Q27.5 28 15 28 Q3 27 4 15 Q4.5 3 16.7 4 Q27 4.5 27 16Z',
    lines: ['M16 9 L15.7 16 L21 19', 'M8 7 L9 8'],
  },
};

export function HandDrawnIcon({ name, size = 24, color = palette.ink }: { name: string; size?: number; color?: string }) {
  const drawing = drawings[name];
  if (!drawing) return null;
  const light = color.toLowerCase() === '#fff' || color.toLowerCase() === '#ffffff';
  return <Svg width={size} height={size} viewBox="0 0 32 32" accessible={false}>
    <G stroke={color} strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" fill="none">
      {drawing.silhouette && <Path d={drawing.silhouette} fill={light ? 'none' : palette.apricot} />}
      {drawing.lines.map((line, index) => <Path key={index} d={line} />)}
    </G>
  </Svg>;
}
