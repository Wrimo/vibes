// Colour palettes. Each chapter (and each arena / challenge set) gets its own
// muted palette, in the spirit of the original game's chapters.
'use strict';
SQ.PALETTES = {
  sand: {
    bg: '#a89670', bgEdge: '#7f7150', border: '#5f5a45', wall: '#7a7556',
    player: '#cbb98d', playerHot: '#efe2bf', square: '#e3e8c4', squareDim: '#b8ac78',
    enemy: '#bfb27c', enemy2: '#d9cc96', hazard: '#eef0d6', text: '#3e3a2b', ui: '#efe6cc',
  },
  dusk: {
    bg: '#5e6e98', bgEdge: '#44527a', border: '#1e1629', wall: '#221829',
    player: '#cfc0b4', playerHot: '#f4e8dc', square: '#ecdba8', squareDim: '#9d987f',
    enemy: '#323037', enemy2: '#231a2c', hazard: '#c6d4f5', text: '#1e1629', ui: '#e6ddf2',
  },
  tide: {
    bg: '#3e5755', bgEdge: '#2b3c3b', border: '#4c5a4f', wall: '#2a3836',
    player: '#d1bc95', playerHot: '#f3e5c4', square: '#e9e1bf', squareDim: '#8b8f78',
    enemy: '#a2172f', enemy2: '#6c1027', hazard: '#d9e3c8', text: '#c9d3c0', ui: '#e9eedf',
  },
  ember: {
    bg: '#5a4a72', bgEdge: '#3b3050', border: '#271e33', wall: '#2a2037',
    player: '#f1dcb8', playerHot: '#fff2dc', square: '#ffe7a3', squareDim: '#a8957a',
    enemy: '#ef8a4c', enemy2: '#c25f33', hazard: '#ffbd7a', text: '#f1dcb8', ui: '#f6eadb',
  },
  rust: {
    bg: '#8b513c', bgEdge: '#5f3427', border: '#3a1f17', wall: '#3b2019',
    player: '#f3e3c7', playerHot: '#fffaf0', square: '#fff2d2', squareDim: '#c09a80',
    enemy: '#23303a', enemy2: '#3f5666', hazard: '#78d3c8', text: '#fbe9d5', ui: '#fbe9d5',
  },
  mono: {
    bg: '#dcd9d1', bgEdge: '#aeaa9f', border: '#2c2b29', wall: '#2c2b29',
    player: '#3a3936', playerHot: '#000000', square: '#141414', squareDim: '#8a877f',
    enemy: '#c4322f', enemy2: '#7d1d1b', hazard: '#c4322f', text: '#2c2b29', ui: '#2c2b29',
  },
  night: {
    bg: '#283041', bgEdge: '#1a1f2b', border: '#10131b', wall: '#121620',
    player: '#d7dbe6', playerHot: '#ffffff', square: '#9ff0d0', squareDim: '#5b6b72',
    enemy: '#ff6f91', enemy2: '#b8456a', hazard: '#ffd36f', text: '#d7dbe6', ui: '#e8ecf6',
  },
  moss: {
    bg: '#56664a', bgEdge: '#3b4733', border: '#232a1e', wall: '#262e20',
    player: '#e8e0c4', playerHot: '#fffbea', square: '#f1f5c9', squareDim: '#9aa184',
    enemy: '#2b2f2a', enemy2: '#474e40', hazard: '#f6e27a', text: '#e8e0c4', ui: '#f1ecd9',
  },
};
