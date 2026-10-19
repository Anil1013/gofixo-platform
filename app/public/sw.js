self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Gofixo', body: 'New service request' };
  }

  if (data.type === 'booking_cancelled') {
    event.waitUntil(
      self.registration.getNotifications({ tag: data.tag || 'gofixo-request' }).then((notifications) => {
        notifications.forEach((notification) => notification.close());
      })
    );
    return;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Gofixo', {
      body: data.body || 'New service request',
      tag: data.tag || 'gofixo-request',
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [500, 200, 500, 200, 800],
      icon: '/favicon.ico',
      data: { url: data.url || '/', booking_id: data.booking_id || null }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
