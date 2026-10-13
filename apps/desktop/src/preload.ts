import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('rdi', {
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('rdi:pick-folder') as Promise<string | null>,
  openExternal: (url: string): void => {
    void ipcRenderer.invoke('rdi:open-external', url);
  },
});
