import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'api_service.dart';

const AndroidNotificationChannel _requestChannel = AndroidNotificationChannel(
  'gofixo_requests',
  'Gofixo service requests',
  description: 'Alerts for nearby ride and home-service requests',
  importance: Importance.max,
  playSound: true,
);

final FlutterLocalNotificationsPlugin _localNotifications = FlutterLocalNotificationsPlugin();

int _notificationId(RemoteMessage message) =>
    int.tryParse(message.data['booking_id']?.toString() ?? '') ??
    (message.data['booking_id']?.toString().hashCode ?? 0);

@pragma('vm:entry-point')
Future<void> gofixoFirebaseBackgroundHandler(RemoteMessage message) async {
  await Firebase.initializeApp();
  await _localNotifications.initialize(
    const InitializationSettings(
      android: AndroidInitializationSettings('@mipmap/ic_launcher'),
    ),
  );
  if (message.data['type'] == 'booking_cancelled') {
    await _localNotifications.cancel(_notificationId(message));
  }
}

class PushService {
  PushService._();
  static bool _initialized = false;
  static String? _lastRegisteredProvider;

  static Future<void> initialize() async {
    if (defaultTargetPlatform != TargetPlatform.android || _initialized) return;
    _initialized = true;
    FirebaseMessaging.onBackgroundMessage(gofixoFirebaseBackgroundHandler);
    await _localNotifications.initialize(
      const InitializationSettings(
        android: AndroidInitializationSettings('@mipmap/ic_launcher'),
      ),
      onDidReceiveNotificationResponse: (_) {},
    );
    await _localNotifications
        .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
        ?.createNotificationChannel(_requestChannel);

    try {
      await FirebaseMessaging.instance.requestPermission(
        alert: true,
        badge: true,
        sound: true,
        provisional: false,
      );
    } catch (error) {
      debugPrint('Gofixo notification permission request failed: $error');
    }

    FirebaseMessaging.onMessage.listen(_handleForegroundMessage);
    FirebaseMessaging.onMessageOpenedApp.listen((message) {
      if (message.data['type'] == 'booking_cancelled') {
        _localNotifications.cancel(_notificationId(message));
      }
    });
    FirebaseMessaging.instance.onTokenRefresh.listen((_) async {
      _lastRegisteredProvider = null;
      final session = await ApiService.loadSession();
      if (session != null && session.role == 'provider') {
        await syncProviderToken(session);
      }
    });
  }

  static Future<void> _handleForegroundMessage(RemoteMessage message) async {
    final id = _notificationId(message);
    if (message.data['type'] == 'booking_cancelled') {
      await _localNotifications.cancel(id);
      return;
    }
    final title = message.notification?.title ?? message.data['title'] ?? 'Gofixo — New service request';
    final body = message.notification?.body ?? message.data['body'] ?? 'A nearby service request is available.';
    await _localNotifications.show(
      id,
      title,
      body,
      NotificationDetails(
        android: AndroidNotificationDetails(
          _requestChannel.id,
          _requestChannel.name,
          channelDescription: _requestChannel.description,
          importance: Importance.max,
          priority: Priority.max,
          playSound: true,
          category: AndroidNotificationCategory.call,
          tag: 'gofixo-booking-${message.data['booking_id'] ?? ''}',
        ),
      ),
      payload: message.data['booking_id']?.toString(),
    );
  }

  static Future<void> syncProviderToken(Session session) async {
    if (defaultTargetPlatform != TargetPlatform.android || session.role != 'provider' || session.userId == null) return;
    final key = '${session.userId}:${session.token}';
    if (_lastRegisteredProvider == key) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await ApiService.registerProviderFcmToken(token, session.token, session.userId!);
      _lastRegisteredProvider = key;
    } catch (error) {
      debugPrint('Gofixo provider FCM token registration failed: $error');
    }
  }
}
