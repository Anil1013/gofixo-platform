import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo role screen renders', (tester) async {
    await tester.pumpWidget(const GofixoApp());

    // Gate performs SharedPreferences initialization asynchronously.
    // Run just enough frames for the FutureBuilder to resolve without
    // waiting for app-wide timers or periodic work to settle.
    await tester.pump(const Duration(milliseconds: 100));
    await tester.pump(const Duration(milliseconds: 100));

    expect(find.text('Gofixo'), findsOneWidget);
    expect(find.text('Welcome to Gofixo'), findsOneWidget);
    expect(find.text('Continue as Customer'), findsOneWidget);
    expect(find.text('Continue as Partner'), findsOneWidget);
  });
}
