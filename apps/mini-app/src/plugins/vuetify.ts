import { createVuetify } from 'vuetify';
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg';
import { ru } from 'vuetify/locale';
import { colors, layout } from '../design/tokens';

export const vuetify = createVuetify({
  locale: { locale: 'ru', messages: { ru } },
  icons: { defaultSet: 'mdi', aliases, sets: { mdi } },
  display: {
    mobileBreakpoint: 'md',
    thresholds: { xs: 0, sm: 600, md: 960, lg: 1280, xl: 1920, xxl: 2560 },
  },
  theme: {
    defaultTheme: 'shtanishkin',
    themes: {
      shtanishkin: {
        dark: true,
        colors,
        variables: {
          'border-color': colors.border,
          'border-opacity': 1,
          'high-emphasis-opacity': 1,
          'medium-emphasis-opacity': 0.7,
          'hover-opacity': 0.06,
          'selected-opacity': 0.12,
        },
      },
    },
  },
  defaults: {
    global: { ripple: false },
    VBtn: {
      elevation: 0,
      rounded: 'md',
      height: layout.controlHeight,
      variant: 'flat',
      color: 'raised',
      class: 'text-none font-weight-semibold',
    },
    VCard: { elevation: 0, rounded: 'lg', color: 'surface' },
    VSheet: { color: 'transparent' },
    VTextField: {
      variant: 'outlined',
      density: 'comfortable',
      rounded: 'md',
      hideDetails: 'auto',
      color: 'primary',
      bgColor: 'field',
      baseColor: 'muted',
      singleLine: true,
    },
    VChip: { size: 'small', rounded: 'sm', variant: 'flat', class: 'app-chip' },
    VTabs: {
      height: 32,
      hideSlider: true,
      color: 'on-surface',
      density: 'compact',
    },
    VTab: {
      rounded: 'sm',
      class: 'text-none text-body-small text-md-label-large',
      height: 32,
    },
    VListItem: { rounded: 'md', minHeight: 48 },
    VDivider: { opacity: 1, color: 'border' },
    VAlert: { rounded: 'md', variant: 'tonal', density: 'compact' },
    VTable: { density: 'comfortable', hover: true },
    VDialog: { scrollable: true, maxWidth: layout.cameraWidth },
    VTooltip: { location: 'top' },
  },
});
