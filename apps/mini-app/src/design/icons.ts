import ordersActive from '../assets/figma/orders-active.svg';
import warehouseInactive from '../assets/figma/orders-warehouse.svg';
import home from '../assets/figma/mobile-bf55f.svg';
import orders from '../assets/figma/mobile-143fd.svg';
import warehouse from '../assets/figma/mobile-b354c.svg';
import finance from '../assets/figma/mobile-29662.svg';
import team from '../assets/figma/mobile-9c469.svg';
import check from '../assets/figma/mobile-c5583.svg';
import camera from '../assets/figma/mobile-613c3.svg';
import scan from '../assets/figma/mobile-d2903.svg';
import scanField from '../assets/figma/mobile-098a5.svg';
import scanDesktop from '../assets/figma/desktop-965c8.svg';
import usb from '../assets/figma/mobile-838a3.svg';
import down from '../assets/figma/mobile-2db49.svg';
import chevron from '../assets/figma/mobile-557e1.svg';
import phone from '../assets/figma/desktop-3b37a.svg';
import search from '../assets/figma/desktop-e776a.svg';
import info from '../assets/figma/desktop-f1d2e.svg';
import clock from '../assets/figma/desktop-e5cf4.svg';
import plus from '../assets/figma/desktop-2cfaa.svg';
import warehouseSmall from '../assets/figma/desktop-e0d4e.svg';
import warehouseMuted from '../assets/figma/desktop-d0d47.svg';
import close from '../assets/figma/camera-536a4.svg';
import flash from '../assets/figma/camera-f5bdd.svg';

export const icons = {
  ordersActive: { src: ordersActive, width: 20, height: 20 },
  warehouseInactive: { src: warehouseInactive, width: 20, height: 20 },
  home: { src: home, width: 20, height: 20 },
  orders: { src: orders, width: 20, height: 20 },
  warehouse: { src: warehouse, width: 20, height: 20 },
  finance: { src: finance, width: 20, height: 20 },
  team: { src: team, width: 20, height: 20 },
  check: { src: check, width: 18, height: 18 },
  camera: { src: camera, width: 22, height: 22 },
  scan: { src: scan, width: 20, height: 20 },
  scanField: { src: scanField, width: 18, height: 18 },
  scanDesktop: { src: scanDesktop, width: 22, height: 22 },
  usb: { src: usb, width: 14, height: 14 },
  down: { src: down, width: 14, height: 14 },
  chevron: { src: chevron, width: 16, height: 16 },
  phone: { src: phone, width: 18, height: 18 },
  search: { src: search, width: 18, height: 18 },
  info: { src: info, width: 16, height: 16 },
  clock: { src: clock, width: 18, height: 18 },
  plus: { src: plus, width: 18, height: 18 },
  warehouseSmall: { src: warehouseSmall, width: 18, height: 18 },
  warehouseMuted: { src: warehouseMuted, width: 16, height: 16 },
  close: { src: close, width: 18, height: 18 },
  flash: { src: flash, width: 20, height: 20 },
} as const;
export type DesignIconName = keyof typeof icons;
