import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo role selection screen shows customer and partner journeys',
      (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        title: 'Gofixo',
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: orange),
        ),
        home: const RoleScreen(onLogin: _noop),
      ),
    );
    await tester.pump();

    expect(find.text('Gofixo'), findsWidgets);
    expect(find.text('Welcome to Gofixo'), findsOneWidget);
    expect(find.text('Choose your Gofixo experience'), findsOneWidget);

    expect(find.text('I am a Customer'), findsOneWidget);
    expect(find.text('I am a Partner'), findsOneWidget);
    expect(
      find.text('Book bike, auto or car rides, or find reliable professionals for everyday home needs.'),
      findsOneWidget,
    );
    expect(
      find.text('Join as a driver or service professional. Get booking requests, serve customers and grow your earnings.'),
      findsOneWidget,
    );
    expect(find.textContaining('Electrician'), findsWidgets);
    expect(find.text('CUSTOMER LOGIN'), findsOneWidget);
    expect(find.text('PARTNER LOGIN'), findsOneWidget);
    expect(find.text('What do you need today?'), findsNothing);
    expect(find.text('Home & Lifestyle Services'), findsNothing);
    expect(find.text('Earn with Gofixo'), findsNothing);
  });
}

void _noop() {}
