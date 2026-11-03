import 'dart:async';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
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
const MethodChannel _bookingAlertChannel = MethodChannel('gofixo/booking_alert');

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
  static String? _lastRegisteredCustomer;

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
      _lastRegisteredCustomer = null;
      final session = await ApiService.loadSession();
      if (session == null) return;
      if (session.role == 'provider') await syncProviderToken(session);
      if (session.role == 'customer') await syncCustomerToken(session);
    });
  }

  static Future<void> _handleForegroundMessage(RemoteMessage message) async {
    final type = message.data['type'];
    // The native Android foreground service owns the repeating ringtone,
    // vibration and persistent notification for partner booking requests.
    // Avoid showing a second Flutter notification for the same incoming call.
    if (type == 'booking_request') return;

    final id = _notificationId(message);
    if (type == 'booking_cancelled') {
      await _localNotifications.cancel(id);
      return;
    }
    final title = message.notification?.title ?? 'Gofixo booking update';
    final body = message.notification?.body ?? 'Your booking status has changed.';
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
          priority: Priority.high,
          playSound: true,
        ),
      ),
      payload: message.data['booking_id']?.toString(),
    );
    // Native Android FirebaseMessagingService owns provider request sound,
    // vibration, and the ongoing notification in foreground and background.
  }

  static Future<void> stopBookingAlert([int? bookingId]) async {
    if (defaultTargetPlatform != TargetPlatform.android) return;
    try {
      await _bookingAlertChannel.invokeMethod<void>('stop', {
        if (bookingId != null) 'bookingId': bookingId.toString(),
      });
    } catch (error) {
      debugPrint('Could not stop native booking alert: $error');
    }
  }

  static Future<void> syncCustomerToken(Session session) async {
    if (defaultTargetPlatform != TargetPlatform.android || session.role != 'customer') return;
    final key = '${session.userId}:${session.token}';
    if (_lastRegisteredCustomer == key) return;
    try {
      final token = await FirebaseMessaging.instance.getToken();
      if (token == null || token.isEmpty) return;
      await ApiService.registerCustomerFcmToken(token, session.token);
      _lastRegisteredCustomer = key;
    } catch (error) {
      debugPrint('Gofixo customer FCM token registration failed: $error');
    }
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
