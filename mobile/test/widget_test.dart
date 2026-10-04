import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo role screen renders', (tester) async {
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

    expect(find.text('Gofixo'), findsOneWidget);
    expect(find.text('Welcome to Gofixo'), findsOneWidget);
    expect(find.text('Continue as Customer'), findsOneWidget);
    expect(find.text('Continue as Partner'), findsOneWidget);
  });
}

void _noop() {}
