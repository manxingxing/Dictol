export type PanelCallback = (error: Error | null, event: string) => void

export interface SelectionPanelBounds {
  x: number
  y: number
  width: number
  height: number
}

export declare function configureElectronPanel(nativeWindowHandle: Buffer): void
export declare function createSelectionPanel(
  panelId: number,
  nativeWindowHandle: Buffer,
  resizable: boolean,
  movable: boolean,
  callback: PanelCallback
): void
export declare function destroySelectionPanel(panelId: number): void
export declare function getSelectionPanelBounds(panelId: number): SelectionPanelBounds
export declare function hideSelectionPanel(panelId: number): void
export declare function selectionPanelState(panelId: number): number
export declare function setSelectionPanelBounds(panelId: number, bounds: SelectionPanelBounds): void
export declare function showSelectionPanel(panelId: number, focus: boolean): void
export declare function showSelectionPanelDisableMenu(panelId: number, enabled: boolean): boolean
