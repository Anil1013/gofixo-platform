# Gofixo Android Firebase Cloud Messaging setup

## Already configured in the repository

- Android Firebase client config: mobile/android/app/google-services.json
- Flutter FCM token registration and notification channel
- Backend provider token storage and FCM send integration

## Required backend secret

The Firebase client files do not grant the backend permission to send pushes. Create a service account in Firebase Console / Google Cloud IAM for the gofixo project, then store the full JSON key only as the backend environment variable FIREBASE_SERVICE_ACCOUNT_JSON (for example in AWS Systems Manager Parameter Store/Secrets Manager and inject it into the EC2/Elastic Beanstalk environment). Do not commit a service-account JSON key to GitHub or include it in the mobile app. Restart/redeploy the backend after configuring the variable.

The backend uses this variable to send request notifications to registered partner FCM tokens. Without it, web push continues to work but native FCM delivery is not active.

## Verification checklist

1. Run flutter pub get, flutter analyze, flutter test, and an Android build.
2. Log in as a provider on a real Android device and allow notifications.
3. Verify that service_providers.fcm_token is populated for that provider.
4. With backend credentials configured, create a matching request from a customer account while the partner app is foregrounded, backgrounded, and the screen is locked.
5. Have another partner accept; verify that the other partners' request alert is silenced/replaced.

Notification sound and background behavior still depend on user permissions, Focus/Do Not Disturb, device power settings, and platform delivery rules. A continuously ringing custom alarm cannot be guaranteed by FCM alone.
