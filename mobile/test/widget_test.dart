import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo reference entry screen renders', (tester) async {
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
    expect(find.text('Choose your ride'), findsOneWidget);
    expect(find.text('Home services'), findsOneWidget);
    expect(find.text('Book now'), findsOneWidget);
    expect(find.text('Partner with Gofixo'), findsOneWidget);
  });
}

void _noop() {}
