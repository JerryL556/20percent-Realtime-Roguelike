import { GameState } from './GameState.js';

const STORAGE_KEY = 'rogue_like_save_v1';

export const SaveManager = {
  saveToLocal(gameState) {
    try {
      const data = JSON.stringify(gameState.serialize());
      localStorage.setItem(STORAGE_KEY, data);
      return true;
    } catch (e) {
      console.error('Failed to save', e);
      return false;
    }
  },

  loadFromLocal() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      if (!data) return null;
      const obj = JSON.parse(data);
      return GameState.deserialize(obj);
    } catch (e) {
      console.error('Failed to load', e);
      return null;
    }
  },

  download(gameState) {
    const data = JSON.stringify(gameState.serialize(), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = url;
    a.download = `rogue-save-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  async uploadFromFile() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = () => {
        const file = input.files?.[0];
        if (!file) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const obj = JSON.parse(String(reader.result));
            resolve(GameState.deserialize(obj));
          } catch (e) {
            console.error('Invalid save file', e);
            resolve(null);
          }
        };
        reader.readAsText(file);
      };
      input.click();
    });
  },
};

