import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function initNotifications() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    await Notifications.requestPermissionsAsync();
  }
}

export async function notifyFavoriteSaved(recipeName: string) {
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Favorite Saved',
      body: `${recipeName} was added to favorites`,
    },
    trigger: null,
  });
}
