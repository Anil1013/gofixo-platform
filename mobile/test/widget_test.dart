import 'package:flutter_test/flutter_test.dart';
import 'package:mobile/main.dart';

void main() {
  testWidgets('Gofixo app renders', (tester) async {
    await tester.pumpWidget(const GofixoApp());
    await tester.pumpAndSettle();
    expect(find.text('Gofixo'), findsOneWidget);
    expect(find.text('Welcome to Gofixo'), findsOneWidget);
  });
}
