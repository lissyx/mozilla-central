
partial interface Navigator {
  const short LIGHT_BACKLIGHT = 0;
  const short LIGHT_KEYBOARD = 1;
  const short LIGHT_BUTTONS = 2;
  const short LIGHT_BATTERY = 3;
  const short LIGHT_NOTIFICATIONS = 4;
  const short LIGHT_ATTENTION = 5;
  const short LIGHT_BLUETOOTH = 6;
  const short LIGHT_WIFI = 7;

  const short LIGHT_FLASH_NONE = 0;
  const short LIGHT_FLASH_TIMED = 1;
  const short LIGHT_FLASH_HARDWARE = 2;

  void setLight(short light, unsigned long color, short flashMode, short flashOnMS, short flashOffMS);
};
