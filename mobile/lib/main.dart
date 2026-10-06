import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:file_picker/file_picker.dart';
import 'package:geolocator/geolocator.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart';
import 'api_service.dart';
import 'update_service.dart';
import 'ota_service.dart';
import 'package:flutter_ota_kit/flutter_ota_kit.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'app_info_page.dart';

const orange=Color(0xFFFF6B00), navy=Color(0xFF172B4D), muted=Color(0xFF64748B);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await FlutterPatcher.init();
  runApp(const GofixoApp());
}

class GofixoApp extends StatelessWidget{
  const GofixoApp({super.key});
  @override Widget build(BuildContext c)=>MaterialApp(debugShowCheckedModeBanner:false,title:'Gofixo',theme:ThemeData(useMaterial3:true,colorScheme:ColorScheme.fromSeed(seedColor:orange),scaffoldBackgroundColor:const Color(0xFFF7F9FC)),home:const Gate());
}

class Gate extends StatefulWidget{const Gate({super.key});@override State<Gate> createState()=>_GateState();}
class _GateState extends State<Gate>{
  Future<Session?>? f;
  bool updateChecked=false;
  @override void initState(){super.initState();f=ApiService.loadSession();}
  void refresh()=>setState(()=>f=ApiService.loadSession());
  @override Widget build(BuildContext c){
    return FutureBuilder<Session?>(
      future:f,
      builder:(c,s){
        if(s.connectionState!=ConnectionState.done)return const Scaffold(body:Center(child:CircularProgressIndicator()));
        if(!updateChecked){
          updateChecked=true;
          WidgetsBinding.instance.addPostFrameCallback((_) {
            UpdateService.checkAndPrompt(c);
            OtaService.checkAndApply();
          });
        }
        final x=s.data;
        if(x==null)return RoleScreen(onLogin:refresh);
        return x.role=='provider'
            ?ProviderHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();})
            :CustomerHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();});
      },
    );
  }
}

class RoleScreen extends StatelessWidget{
  final VoidCallback onLogin;
  const RoleScreen({super.key,required this.onLogin});

  @override
  Widget build(BuildContext c)=>Scaffold(
    appBar: AppBar(
      title: const Text('Gofixo'),
      actions: [
        IconButton(
          tooltip: 'App information',
          onPressed: ()=>Navigator.push(
            c,
            MaterialPageRoute(builder:(_)=>const AppInfoPage()),
          ),
          icon: const Icon(Icons.settings_outlined),
        ),
      ],
    ),
    body:SafeArea(child:Center(child:SingleChildScrollView(padding:const EdgeInsets.all(24),child:Column(children:[
      const SizedBox(height:20),
      Container(width:86,height:86,decoration:BoxDecoration(color:orange,borderRadius:BorderRadius.circular(25)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:50)),
      const SizedBox(height:16),
      const Text('Gofixo',style:TextStyle(fontSize:38,fontWeight:FontWeight.w800,color:navy)),
      const Text('Your City. Your Services.',style:TextStyle(color:muted,fontSize:16)),
      const SizedBox(height:45),
      const Text('Welcome to Gofixo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w700)),
      const SizedBox(height:24),
      _RoleButton(title:'Continue as Customer',subtitle:'Book rides quickly and safely',icon:Icons.person_rounded,onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'customer',onDone:onLogin)))),
      const SizedBox(height:14),
      _RoleButton(title:'Continue as Partner',subtitle:'Go online, accept jobs and earn',icon:Icons.directions_bike_rounded,outline:true,onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'provider',onDone:onLogin)))),
    ])))));
}

class _RoleButton extends StatelessWidget{
  final String title,subtitle;final IconData icon;final bool outline;final VoidCallback onTap;
  const _RoleButton({required this.title,required this.subtitle,required this.icon,required this.onTap,this.outline=false});
  @override Widget build(BuildContext c)=>Card(color:outline?Colors.white:orange,child:InkWell(onTap:onTap,borderRadius:BorderRadius.circular(18),child:Padding(padding:const EdgeInsets.all(18),child:Row(children:[Icon(icon,size:32,color:outline?orange:Colors.white),const SizedBox(width:16),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(title,style:TextStyle(fontWeight:FontWeight.w700,color:outline?navy:Colors.white,fontSize:16)),Text(subtitle,style:TextStyle(color:outline?muted:Colors.white70))])),Icon(Icons.arrow_forward_ios,size:16,color:outline?orange:Colors.white)]))));
}

class Auth extends StatefulWidget{
  final String role;final VoidCallback onDone;const Auth({super.key,required this.role,required this.onDone});
  @override State<Auth> createState()=>_AuthState();
}
class _AuthState extends State<Auth>{
  final form=GlobalKey<FormState>();final name=TextEditingController(),phone=TextEditingController(),pass=TextEditingController();String mode='login',type='bike';bool busy=false;String? error,msg;String appVersion='';String buildNumber='';
  bool get provider=>widget.role=='provider';
  @override void initState(){super.initState();_loadAppVersion();}
  Future<void> _loadAppVersion() async {try{final info=await PackageInfo.fromPlatform();if(mounted)setState((){appVersion=info.version;buildNumber=info.buildNumber;});}catch(_){}}
  @override void dispose(){name.dispose();phone.dispose();pass.dispose();super.dispose();}
  Future<void> submit()async{if(!form.currentState!.validate())return;setState((){busy=true;error=null;msg=null;});try{
    if(mode=='register'){if(provider)await ApiService.registerProvider(name.text.trim(),phone.text.trim(),type,pass.text);else await ApiService.registerCustomer(name.text.trim(),phone.text.trim(),pass.text);if(!mounted)return;setState((){mode='login';msg='Account created. Please log in.';});}
    else if(mode=='forgot'){await ApiService.forgotPassword(widget.role,phone.text.trim());if(!mounted)return;setState((){mode='login';msg='Reset request submitted.';});}
    else{await ApiService.login(widget.role,phone.text.trim(),pass.text);if(mounted){Navigator.pop(context);widget.onDone();}}
  }catch(e){if(mounted)setState(()=>error=e.toString().replaceFirst('Exception: ',''));}finally{if(mounted)setState(()=>busy=false);}}
  @override Widget build(BuildContext c){final reg=mode=='register',forgot=mode=='forgot';return Scaffold(appBar:AppBar(title:Text(provider?'Partner':'Customer')),body:Form(key:form,child:ListView(padding:const EdgeInsets.all(24),children:[
    Align(alignment:Alignment.topRight,child:Text(appVersion.isEmpty?'Version':'v$appVersion • Build $buildNumber',style:const TextStyle(fontSize:12,color:muted,fontWeight:FontWeight.w600))),
    const SizedBox(height:8),
    Text(forgot?'Forgot password':reg?'Create account':'Log in',style:const TextStyle(fontSize:28,fontWeight:FontWeight.w800,color:navy)),const SizedBox(height:22),
    if(reg)TextFormField(controller:name,decoration:const InputDecoration(labelText:'Name',border:OutlineInputBorder()),validator:(v)=>v==null||v.trim().isEmpty?'Enter your name':null),
    if(reg)const SizedBox(height:14),
    if(reg&&provider)DropdownButtonFormField<String>(initialValue:type,decoration:const InputDecoration(labelText:'Partner type',border:OutlineInputBorder()),items:const[
      DropdownMenuItem(value:'bike',child:Text('Bike driver')),DropdownMenuItem(value:'auto',child:Text('Auto driver')),DropdownMenuItem(value:'car',child:Text('Car driver')),DropdownMenuItem(value:'general_worker',child:Text('Home helper')),DropdownMenuItem(value:'skilled_worker',child:Text('Skilled worker'))],onChanged:(v)=>setState(()=>type=v??'bike')),
    if(reg&&provider)const SizedBox(height:14),
    TextFormField(controller:phone,keyboardType:TextInputType.phone,maxLength:10,decoration:const InputDecoration(labelText:'Phone number',prefixText:'+91 ',border:OutlineInputBorder()),validator:(v)=>RegExp(r'^\d{10}$').hasMatch(v?.trim()??'')?null:'Enter 10 digits'),
    if(!forgot)const SizedBox(height:14),
    if(!forgot)TextFormField(controller:pass,obscureText:true,decoration:const InputDecoration(labelText:'Password',border:OutlineInputBorder()),validator:(v)=>v==null||v.length<8?'Minimum 8 characters':null),
    if(error!=null)Padding(padding:const EdgeInsets.only(top:14),child:Text(error!,style:const TextStyle(color:Colors.red))),
    if(msg!=null)Padding(padding:const EdgeInsets.only(top:14),child:Text(msg!,style:const TextStyle(color:Colors.green))),
    const SizedBox(height:20),SizedBox(height:52,child:FilledButton(onPressed:busy?null:submit,child:busy?const CircularProgressIndicator():Text(forgot?'Request reset':reg?'Create account':'Log in'))),
    if(mode=='login')...[
      TextButton(onPressed:()=>setState(()=>mode='register'),child:const Text('New here? Create account')),
      TextButton(onPressed:()=>setState(()=>mode='forgot'),child:const Text('Forgot password?')),
    ]else TextButton(onPressed:()=>setState(()=>mode='login'),child:const Text('Back to login')),
   ])));}
}


class CustomerHome extends StatefulWidget{
  final Session session; final Future<void> Function() onLogout;
  const CustomerHome({super.key,required this.session,required this.onLogout});
  @override State<CustomerHome> createState()=>_CustomerHomeState();
}
class _CustomerHomeState extends State<CustomerHome>{
  List<Map<String,dynamic>> bookings=[]; Timer? timer; bool loading=true; int tab=0;
  @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
  @override void dispose(){timer?.cancel();super.dispose();}
  Future<void> load({bool silent=false})async{try{final b=await ApiService.customerBookings(widget.session.token);if(mounted)setState((){bookings=b;loading=false;});}catch(e){if(!silent&&mounted)_snack(e.toString());}}
  void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
  void _book()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>BookingPage(session:widget.session,onChanged:load)));
  Widget _logo()=>Row(children:[
    Container(width:34,height:34,decoration:BoxDecoration(color:orange,borderRadius:BorderRadius.circular(11)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:24)),
    const SizedBox(width:8),const Text('Gofi',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:navy)),const Text('xo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:orange))
  ]);
  Widget _header()=>Padding(padding:const EdgeInsets.fromLTRB(16,12,12,8),child:Row(children:[
    Expanded(child:_logo()),
    IconButton(onPressed:()=>_snack('No new notifications'),icon:const Icon(Icons.notifications_none_rounded,color:navy)),
    CircleAvatar(radius:18,backgroundColor:const Color(0xFFFFE8D1),child:Text(
      (widget.session.name??'G').trim().isEmpty?'G':(widget.session.name??'G').trim()[0].toUpperCase(),
      style:const TextStyle(color:navy,fontWeight:FontWeight.w900)))
  ]));
  Widget _hero()=>Container(
    margin:const EdgeInsets.fromLTRB(16,4,16,14),height:205,
    decoration:BoxDecoration(borderRadius:BorderRadius.circular(24),gradient:const LinearGradient(colors:[Color(0xFFDDF0FF),Color(0xFFF5FAFF)])),
    child:Stack(children:[
      const Positioned(left:18,top:18,child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('Your City',style:TextStyle(fontSize:27,fontWeight:FontWeight.w900,color:navy)),
        Text('Your Services',style:TextStyle(fontSize:27,fontWeight:FontWeight.w900,color:orange)),
        SizedBox(height:6),Text('Rides, Home Services\nand more – All in One App',style:TextStyle(fontSize:13,color:Color(0xFF334155),height:1.35))
      ])),
      Positioned(right:8,bottom:9,child:Row(children:[
        _HeroVehicle(Icons.two_wheeler_rounded,'Bike',const Color(0xFFFFEBD4)),
        const SizedBox(width:7),_HeroVehicle(Icons.airport_shuttle_rounded,'Auto',const Color(0xFFE3F7E8)),
        const SizedBox(width:7),_HeroVehicle(Icons.directions_car_filled_rounded,'Car',const Color(0xFFE2EEFF))
      ]))
    ])
  );
  Widget _ride(String title,String sub,IconData icon,Color bg)=>Expanded(child:InkWell(
    onTap:_book,borderRadius:BorderRadius.circular(18),child:Container(padding:const EdgeInsets.all(9),
    decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:const Color(0xFFE4EAF0))),
    child:Column(children:[
      Container(width:58,height:58,decoration:BoxDecoration(color:bg,borderRadius:BorderRadius.circular(15)),child:Icon(icon,size:34,color:navy)),
      const SizedBox(height:6),Text(title,style:const TextStyle(fontWeight:FontWeight.w800,color:navy)),
      Text(sub,style:const TextStyle(fontSize:9,color:muted),textAlign:TextAlign.center)
    ]))));
  Widget _service(String title,IconData icon)=>Expanded(child:InkWell(
    onTap:()=>_snack(title+' service coming soon'),child:Column(children:[
      Container(width:58,height:58,decoration:BoxDecoration(color:const Color(0xFFF3F6F9),borderRadius:BorderRadius.circular(15)),child:Icon(icon,color:navy,size:28)),
      const SizedBox(height:5),Text(title,style:const TextStyle(fontSize:10,fontWeight:FontWeight.w700,color:navy),textAlign:TextAlign.center,maxLines:1,overflow:TextOverflow.ellipsis)
    ])));
  Widget _section(String title,VoidCallback onTap)=>Padding(padding:const EdgeInsets.fromLTRB(16,0,16,10),child:Row(children:[
    Expanded(child:Text(title,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:navy))),
    TextButton(onPressed:onTap,child:const Text('See all',style:TextStyle(color:Color(0xFF2876C7),fontWeight:FontWeight.w700)))
  ]));
  Widget _home()=>RefreshIndicator(onRefresh:load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.only(bottom:100),children:[
    _header(),_hero(),
    Padding(padding:const EdgeInsets.symmetric(horizontal:16),child:InkWell(onTap:_book,borderRadius:BorderRadius.circular(28),child:Container(height:58,padding:const EdgeInsets.symmetric(horizontal:16),
      decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(28),border:Border.all(color:const Color(0xFFE3E9F0))),
      child:const Row(children:[Icon(Icons.location_on_rounded,color:navy),SizedBox(width:10),Expanded(child:Text('Where are you going?',style:TextStyle(color:muted,fontSize:15))),Icon(Icons.my_location_rounded,color:navy)])))),
    const SizedBox(height:18),_section('Book a Ride',_book),
    Padding(padding:const EdgeInsets.symmetric(horizontal:16),child:Row(children:[
      _ride('Bike','Fast & Affordable',Icons.two_wheeler_rounded,const Color(0xFFFFEBD4)),const SizedBox(width:9),
      _ride('Auto','Comfortable Rides',Icons.airport_shuttle_rounded,const Color(0xFFE3F7E8)),const SizedBox(width:9),
      _ride('Car','Spacious & Safe',Icons.directions_car_filled_rounded,const Color(0xFFE2EEFF))
    ])),
    const SizedBox(height:20),_section('Home Services',()=>setState(()=>tab=2)),
    Padding(padding:const EdgeInsets.symmetric(horizontal:16),child:Column(children:[
      Row(children:[_service('Electrician',Icons.electrical_services_rounded),_service('Plumber',Icons.plumbing_rounded),_service('AC Service',Icons.ac_unit_rounded),_service('Cleaning',Icons.cleaning_services_rounded)]),
      const SizedBox(height:14),
      Row(children:[_service('Painter',Icons.format_paint_rounded),_service('Carpenter',Icons.handyman_rounded),_service('Appliance',Icons.local_laundry_service_rounded),_service('More',Icons.apps_rounded)])
    ])),
    const SizedBox(height:20),
    Container(margin:const EdgeInsets.symmetric(horizontal:16),padding:const EdgeInsets.all(15),decoration:BoxDecoration(
      borderRadius:BorderRadius.circular(20),gradient:const LinearGradient(colors:[Color(0xFFE3F4FF),Color(0xFFF7FBFF)]),border:Border.all(color:const Color(0xFFD7EAF7))),
      child:Row(children:[
        const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Text('Trusted Professionals',style:TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:navy)),
          Text('for Your Home',style:TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:navy)),
          SizedBox(height:5),Text('✓ Verified   ✓ Affordable   ✓ On-Time',style:TextStyle(fontSize:9,color:muted))
        ])),
        Container(width:80,height:92,decoration:BoxDecoration(color:const Color(0xFFBDE0F6),borderRadius:BorderRadius.circular(40)),child:const Icon(Icons.engineering_rounded,color:navy,size:52))
      ])),
    const SizedBox(height:20),
    const Padding(padding:EdgeInsets.symmetric(horizontal:16),child:Text('Why Gofixo?',style:TextStyle(fontSize:19,fontWeight:FontWeight.w900,color:navy))),
    const SizedBox(height:10),
    Padding(padding:const EdgeInsets.symmetric(horizontal:16),child:Row(children:[
      _Benefit(icon:Icons.verified_user_rounded,title:'Verified',subtitle:'Drivers & Experts'),const SizedBox(width:7),
      _Benefit(icon:Icons.currency_rupee_rounded,title:'Affordable',subtitle:'Pricing'),const SizedBox(width:7),
      _Benefit(icon:Icons.schedule_rounded,title:'On-Time',subtitle:'Service'),const SizedBox(width:7),
      _Benefit(icon:Icons.headset_mic_rounded,title:'24/7',subtitle:'Support')
    ]))
  ]));
  Widget _bookings()=>RefreshIndicator(onRefresh:load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.fromLTRB(16,20,16,100),children:[
    const Text('My Bookings',style:TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:12),
    if(bookings.isEmpty)const Card(child:Padding(padding:EdgeInsets.all(24),child:Text('No bookings yet. Book a ride from Home.'))),
    ...bookings.map((b)=>BookingCard(session:widget.session,b:b,onChanged:load))
  ]));
  Widget _services()=>ListView(padding:const EdgeInsets.fromLTRB(16,20,16,100),children:[
    const Text('Services',style:TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:14),
    Wrap(spacing:9,runSpacing:9,children:[
      _ServiceTile('Electrician',Icons.electrical_services_rounded),_ServiceTile('Plumber',Icons.plumbing_rounded),
      _ServiceTile('AC Service',Icons.ac_unit_rounded),_ServiceTile('Cleaning',Icons.cleaning_services_rounded),
      _ServiceTile('Painter',Icons.format_paint_rounded),_ServiceTile('Carpenter',Icons.handyman_rounded),
      _ServiceTile('Appliance Repair',Icons.local_laundry_service_rounded)
    ])
  ]);
  Widget _simple(String title,IconData icon,String msg)=>Center(child:Padding(padding:const EdgeInsets.all(32),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
    Container(width:80,height:80,decoration:BoxDecoration(color:const Color(0xFFFFEBD8),borderRadius:BorderRadius.circular(24)),child:Icon(icon,color:orange,size:42)),
    const SizedBox(height:16),Text(title,style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:8),
    Text(msg,textAlign:TextAlign.center,style:const TextStyle(color:muted))
  ])));
  @override Widget build(BuildContext c){
    Widget body;
    switch(tab){case 1:body=_bookings();break;case 2:body=_services();break;case 3:body=_simple('Wallet',Icons.account_balance_wallet_rounded,'Your wallet and payment history will appear here.');break;case 4:body=_simple('Profile',Icons.person_rounded,'Manage your Gofixo profile and account settings.');break;default:body=_home();}
    return Scaffold(backgroundColor:const Color(0xFFF7F9FC),body:SafeArea(child:loading&&tab==0?const Center(child:CircularProgressIndicator()):body),
      floatingActionButton:tab==0?FloatingActionButton(backgroundColor:orange,foregroundColor:Colors.white,onPressed:_book,child:const Icon(Icons.add_location_alt_rounded)):null,
      bottomNavigationBar:NavigationBar(selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),backgroundColor:Colors.white,indicatorColor:const Color(0xFFFFEAD5),destinations:const[
        NavigationDestination(icon:Icon(Icons.home_outlined),selectedIcon:Icon(Icons.home_rounded),label:'Home'),
        NavigationDestination(icon:Icon(Icons.receipt_long_outlined),selectedIcon:Icon(Icons.receipt_long_rounded),label:'My Bookings'),
        NavigationDestination(icon:Icon(Icons.grid_view_rounded),label:'Services'),
        NavigationDestination(icon:Icon(Icons.account_balance_wallet_outlined),label:'Wallet'),
        NavigationDestination(icon:Icon(Icons.person_outline_rounded),label:'Profile')
      ]));
  }
}
class _HeroVehicle extends StatelessWidget{
  final IconData icon;final String label;final Color color;
  const _HeroVehicle(this.icon,this.label,this.color);
  @override Widget build(BuildContext c)=>Column(children:[
    Container(width:62,height:52,decoration:BoxDecoration(color:color,borderRadius:BorderRadius.circular(15)),child:Icon(icon,size:33,color:navy)),
    const SizedBox(height:3),Container(padding:const EdgeInsets.symmetric(horizontal:9,vertical:3),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(10)),child:Text(label,style:const TextStyle(fontSize:10,fontWeight:FontWeight.w800,color:navy)))
  ]);
}
class _Benefit extends StatelessWidget{
  final IconData icon;final String title,subtitle;
  const _Benefit({required this.icon,required this.title,required this.subtitle});
  @override Widget build(BuildContext c)=>Expanded(child:Container(padding:const EdgeInsets.symmetric(horizontal:4,vertical:10),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(15),border:Border.all(color:const Color(0xFFE4EAF0))),child:Column(children:[
    Icon(icon,size:21,color:orange),const SizedBox(height:4),Text(title,style:const TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:navy)),const SizedBox(height:2),Text(subtitle,style:const TextStyle(fontSize:7,color:muted),textAlign:TextAlign.center)
  ])));
}
class _ServiceTile extends StatelessWidget{
  final String title;final IconData icon;const _ServiceTile(this.title,this.icon);
  @override Widget build(BuildContext c)=>SizedBox(width:104,height:104,child:Card(margin:EdgeInsets.zero,child:InkWell(onTap:()=>ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(title+' service coming soon'))),borderRadius:BorderRadius.circular(15),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
    Icon(icon,color:navy,size:32),const SizedBox(height:7),Text(title,style:const TextStyle(fontWeight:FontWeight.w700,fontSize:11,color:navy),textAlign:TextAlign.center)
  ]))));
}
class BookingPage extends StatefulWidget{
  final Session session;
  final Future<void> Function({bool silent}) onChanged;
  const BookingPage({super.key,required this.session,required this.onChanged});
  @override State<BookingPage> createState()=>_BookingPageState();
}

class _BookingPageState extends State<BookingPage>{
  final drop=TextEditingController();
  Position? pos;
  String pickup='Current location';
  String type='bike';
  double? distance,fare;
  bool busy=false,searching=false;
  List<LatLng> route=[];
  List<Map<String,dynamic>> destinationSuggestions=[];
  Map<String,dynamic>? selectedDestination;
  Timer? searchDebounce;
  String? placeSessionToken;

  @override void dispose(){
    searchDebounce?.cancel();
    drop.dispose();
    super.dispose();
  }

  String _newPlaceSessionToken(){
    final r=Random.secure();
    String hex(int n)=>n.toRadixString(16).padLeft(2,'0');
    final bytes=List<int>.generate(16,(_)=>r.nextInt(256));
    bytes[6]=(bytes[6]&0x0f)|0x40;
    bytes[8]=(bytes[8]&0x3f)|0x80;
    return [
      bytes.sublist(0,4).map(hex).join()
class ProviderHome extends StatefulWidget{
  final Session session;final Future<void> Function() onLogout;
  const ProviderHome({super.key,required this.session,required this.onLogout});
  @override State<ProviderHome> createState()=>_ProviderHomeState();
}
class _ProviderHomeState extends State<ProviderHome>{
  Map<String,dynamic>? me,sub;List<Map<String,dynamic>> jobs=[];Timer? timer;bool busy=false;int tab=0;
  @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
  @override void dispose(){timer?.cancel();super.dispose();}
  Future<void>load({bool silent=false})async{try{final m=await ApiService.providerMe(widget.session.token);final j=await ApiService.providerBookings(widget.session.token);final id=int.tryParse(m['id']?.toString()??'')??widget.session.userId;final s=id==null?null:await ApiService.subscription(widget.session.token,id);if(m['is_available']==true&&id!=null)await sendLocation(silent:true,providerId:id);if(mounted)setState((){me=m;sub=s;jobs=j;});}catch(e){if(!silent&&mounted)snack(e.toString());}}
  Future<void>sendLocation({bool silent=false,int? providerId})async{try{final id=providerId??int.tryParse(me?['id']?.toString()??'');if(id==null)throw Exception('Provider profile ID is missing');final p=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high));await ApiService.updateProviderLocation(widget.session.token,id,p.latitude,p.longitude);}catch(e){if(!silent&&mounted)snack(e.toString());}}
  void snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
  Future<void>toggle()async{if(me==null)return;setState(()=>busy=true);try{final available=me!['is_available']==true;final id=int.tryParse(me!['id']?.toString()??'');if(id==null)throw Exception('Provider profile ID is missing');if(!available)await sendLocation(providerId:id);final x=await ApiService.setAvailability(widget.session.token,id,!available);if(mounted)setState(()=>me=x);}catch(e){if(mounted)snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
  Widget _logo()=>Row(children:[Container(width:32,height:32,decoration:BoxDecoration(color:const Color(0xFF16A05D),borderRadius:BorderRadius.circular(10)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:23)),const SizedBox(width:7),const Text('Gofi',style:TextStyle(fontSize:24,fontWeight:FontWeight.w900,color:navy)),const Text('xo',style:TextStyle(fontSize:24,fontWeight:FontWeight.w900,color:Color(0xFF16A05D)))]);
  Widget _header(){final online=me?['is_available']==true;return Padding(padding:const EdgeInsets.fromLTRB(16,12,12,10),child:Row(children:[
    Expanded(child:_logo()),InkWell(onTap:busy?null:toggle,borderRadius:BorderRadius.circular(20),child:Container(padding:const EdgeInsets.symmetric(horizontal:11,vertical:8),decoration:BoxDecoration(color:online?const Color(0xFFE9F9F0):Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:online?const Color(0xFFBFE6CF):const Color(0xFFE0E7EE))),child:Row(children:[Container(width:8,height:8,decoration:BoxDecoration(color:online?const Color(0xFF12B85F):const Color(0xFF9AA6B6),shape:BoxShape.circle)),const SizedBox(width:6),Text(online?'Online':'Offline',style:TextStyle(fontSize:12,fontWeight:FontWeight.w800,color:online?const Color(0xFF07894A):muted))]))),
    IconButton(onPressed:()=>Navigator.push(context,MaterialPageRoute(builder:(_)=>const AppInfoPage())),icon:const Icon(Icons.settings_outlined,color:navy))
  ]));}
  Widget _profile(){final m=me??{};final name=(m['name']??'Partner').toString();final type=(m['type']??'bike').toString();final vehicle=type.isEmpty?'Partner':type[0].toUpperCase()+type.substring(1);return Container(margin:const EdgeInsets.symmetric(horizontal:16),padding:const EdgeInsets.all(13),decoration:BoxDecoration(borderRadius:BorderRadius.circular(20),border:Border.all(color:const Color(0xFFDDE7E1)),gradient:const LinearGradient(colors:[Colors.white,Color(0xFFF2FBF6)])),child:Row(children:[
    CircleAvatar(radius:29,backgroundColor:const Color(0xFFDFF3E7),child:Text(name.isEmpty?'G':name[0].toUpperCase(),style:const TextStyle(fontSize:24,fontWeight:FontWeight.w900,color:Color(0xFF0D8F50)))),
    const SizedBox(width:11),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Text(name,style:const TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:3),
      Text('★ 4.8  •  '+jobs.length.toString()+' rides',style:const TextStyle(fontSize:11,color:Color(0xFF4B5D74),fontWeight:FontWeight.w700)),
      const SizedBox(height:3),Text(vehicle+'  •  '+(m['generated_id']??'Partner').toString(),style:const TextStyle(fontSize:10,color:muted))
    ])),IconButton(onPressed:widget.onLogout,icon:const Icon(Icons.logout_rounded,color:muted))
  ]));}
  Widget _stat(IconData icon,String value,String label,Color bg)=>Expanded(child:Container(height:78,padding:const EdgeInsets.all(9),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(17),border:Border.all(color:const Color(0xFFE1E8EE))),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Container(width:26,height:26,decoration:BoxDecoration(color:bg,borderRadius:BorderRadius.circular(8)),child:Icon(icon,size:14,color:navy)),const SizedBox(height:3),Text(value,style:const TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:navy)),Text(label,style:const TextStyle(fontSize:8,color:muted,fontWeight:FontWeight.w700))
  ])));
  Widget _request(){final req=jobs.where((x)=>x['status']=='requested').toList();if(req.isEmpty)return Container(margin:const EdgeInsets.fromLTRB(16,0,16,12),padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:const Color(0xFFE1E8EE))),child:const Row(children:[Icon(Icons.inbox_outlined,color:muted,size:28),SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Incoming Bookings',style:TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:navy)),SizedBox(height:3),Text('Stay online to receive nearby ride requests.',style:TextStyle(fontSize:10,color:muted))]))]));final j=req.first;final id=int.tryParse(j['id']?.toString()??'')??0;return Container(margin:const EdgeInsets.fromLTRB(16,0,16,12),padding:const EdgeInsets.all(13),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),border:Border.all(color:const Color(0xFFDDE7E1))),child:Column(children:[
    Row(children:[Container(width:42,height:42,decoration:BoxDecoration(color:const Color(0xFFEAF8F1),borderRadius:BorderRadius.circular(13)),child:const Icon(Icons.two_wheeler_rounded,color:Color(0xFF0D8F50),size:25)),const SizedBox(width:10),const Expanded(child:Text('New Ride Request',style:TextStyle(fontWeight:FontWeight.w900,color:navy))),Text('₹'+(j['fare_amount']??'0').toString(),style:const TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:navy))]),
    const Divider(height:22),
    Row(children:[const Icon(Icons.trip_origin_rounded,color:Color(0xFF16A05D),size:16),const SizedBox(width:7),Expanded(child:Text((j['pickup_location']??'Pickup').toString(),style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:navy)))]),
    const SizedBox(height:7),Row(children:[const Icon(Icons.location_on_rounded,color:orange,size:16),const SizedBox(width:7),Expanded(child:Text((j['drop_or_service_address']??'Destination').toString(),style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:navy)))]),
    const SizedBox(height:12),Row(children:[
      Expanded(child:OutlinedButton(onPressed:()async{await ApiService.declineBooking(widget.session.token,id);await load();},style:OutlinedButton.styleFrom(foregroundColor:Colors.redAccent,side:const BorderSide(color:Color(0xFFF0B7B7))),child:const Text('Reject'))),
      const SizedBox(width:9),Expanded(child:FilledButton(onPressed:()async{try{await ApiService.acceptBooking(widget.session.token,id);await load();}catch(e){snack(e.toString());}},style:FilledButton.styleFrom(backgroundColor:const Color(0xFF0D9F54)),child:const Text('Accept')))
    ])
  ]));}
  Widget _home()=>RefreshIndicator(onRefresh:load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.only(bottom:100),children:[
    _header(),_profile(),
    Padding(padding:const EdgeInsets.fromLTRB(16,10,16,12),child:Row(children:[
      _stat(Icons.route_rounded,jobs.length.toString(),'Today Rides',const Color(0xFFEAF3FF)),const SizedBox(width:8),
      _stat(Icons.currency_rupee_rounded,'₹'+(sub?['total_earned_this_cycle']??0).toString(),'Earnings',const Color(0xFFE9F9EF)),const SizedBox(width:8),
      _stat(Icons.star_rounded,'4.8','Rating',const Color(0xFFFFF3E2))
    ])),
    Container(margin:const EdgeInsets.fromLTRB(16,0,16,13),padding:const EdgeInsets.all(13),decoration:BoxDecoration(borderRadius:BorderRadius.circular(18),gradient:const LinearGradient(colors:[Color(0xFFE8F9EF),Color(0xFFF8FFFB)]),border:Border.all(color:const Color(0xFFCDEBDA))),child:const Row(children:[
      Icon(Icons.emoji_events_rounded,color:Color(0xFF0D8F50),size:34),SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Keep Going!',style:TextStyle(fontSize:15,fontWeight:FontWeight.w900,color:Color(0xFF0D7F4D))),SizedBox(height:2),Text('You are doing great today',style:TextStyle(fontSize:10,color:muted))])),Icon(Icons.chevron_right_rounded,color:muted)
    ])),
    const Padding(padding:EdgeInsets.fromLTRB(16,2,16,9),child:Text('Incoming Bookings',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:navy))),
    _request(),
    if(jobs.isNotEmpty)Container(margin:const EdgeInsets.fromLTRB(16,0,16,12),height:185,clipBehavior:Clip.antiAlias,decoration:BoxDecoration(borderRadius:BorderRadius.circular(18),border:Border.all(color:const Color(0xFFDDE7E1))),child:FlutterMap(
      options:MapOptions(initialCenter:const LatLng(28.4595,77.0266),initialZoom:12),children:[TileLayer(urlTemplate:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',userAgentPackageName:'com.gofixo.app')]))),
    Padding(padding:const EdgeInsets.fromLTRB(16,0,16,12),child:Row(children:[
      const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('You are Online',style:TextStyle(fontSize:14,fontWeight:FontWeight.w900,color:navy)),SizedBox(height:2),Text('Getting ride requests nearby',style:TextStyle(fontSize:9,color:muted))])),
      FilledButton(onPressed:busy?null:toggle,style:FilledButton.styleFrom(backgroundColor:me?['is_available']==true?Colors.redAccent:const Color(0xFF0D9F54)),child:Text(me?['is_available']==true?'Go Offline':'Go Online'))
    ])),
    if(jobs.isNotEmpty)Padding(padding:const EdgeInsets.fromLTRB(16,0,16,12),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      const Text('Recent Jobs',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:8),
      ...jobs.where((x)=>x['status']!='requested').take(3).map((j)=>JobCard(session:widget.session,b:j,onChanged:load))
    ]))
  ]));
  Widget _list(bool requested)=>RefreshIndicator(onRefresh:load,child:ListView(physics:const AlwaysScrollableScrollPhysics(),padding:const EdgeInsets.fromLTRB(16,20,16,100),children:[
    Text(requested?'Incoming Requests':'Rides',style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:12),
    ...(requested?jobs.where((x)=>x['status']=='requested'):jobs.where((x)=>x['status']!='requested')).map((j)=>JobCard(session:widget.session,b:j,onChanged:load))
  ]));
  Widget _simple(String title,IconData icon,String msg)=>Center(child:Padding(padding:const EdgeInsets.all(32),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
    Container(width:80,height:80,decoration:BoxDecoration(color:const Color(0xFFE5F7ED),borderRadius:BorderRadius.circular(24)),child:Icon(icon,color:const Color(0xFF0D8F50),size:42)),const SizedBox(height:16),Text(title,style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:navy)),const SizedBox(height:8),Text(msg,textAlign:TextAlign.center,style:const TextStyle(color:muted))
  ])));
  @override Widget build(BuildContext c){Widget body;switch(tab){case 1:body=_simple('Earnings',Icons.bar_chart_rounded,'Your earnings and subscription summary will appear here.');break;case 2:body=_list(false);break;case 3:body=_simple('Profile',Icons.person_rounded,'Manage your partner profile, KYC and vehicle details.');break;default:body=_home();}return Scaffold(backgroundColor:const Color(0xFFF7FBF9),body:SafeArea(child:body),bottomNavigationBar:NavigationBar(selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),backgroundColor:Colors.white,indicatorColor:const Color(0xFFE5F7ED),destinations:const[
    NavigationDestination(icon:Icon(Icons.home_outlined),selectedIcon:Icon(Icons.home_rounded),label:'Home'),
    NavigationDestination(icon:Icon(Icons.bar_chart_outlined),selectedIcon:Icon(Icons.bar_chart_rounded),label:'Earnings'),
    NavigationDestination(icon:Icon(Icons.list_alt_outlined),selectedIcon:Icon(Icons.list_alt_rounded),label:'Rides'),
    NavigationDestination(icon:Icon(Icons.person_outline_rounded),selectedIcon:Icon(Icons.person_rounded),label:'Profile')
  ]));}
}
t ApiService.createBooking(
        widget.session.token,
        providerType:type,
        pickup:pickup,
        drop:destination,
        lat:pos!.latitude,
        lng:pos!.longitude,
        fare:fare!,
        distanceKm:distance!,
      );
      if(mounted){Navigator.pop(context);widget.onChanged();}
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  @override Widget build(BuildContext c)=>Scaffold(
    appBar:AppBar(title:const Text('Book a ride')),
    body:ListView(padding:const EdgeInsets.all(16),children:[
      SegmentedButton<String>(
        segments:const[
          ButtonSegment(value:'bike',label:Text('Bike')),
          ButtonSegment(value:'auto',label:Text('Auto')),
          ButtonSegment(value:'car',label:Text('Car'))
        ],
        selected:{type},
        onSelectionChanged:(s)=>setState(()=>type=s.first)
      ),
      const SizedBox(height:14),
      Card(child:ListTile(
        leading:const Icon(Icons.my_location,color:orange),
        title:Text(pickup),
        subtitle:const Text('Pickup'),
        trailing:IconButton(onPressed:busy?null:locate,icon:const Icon(Icons.gps_fixed))
      )),
      const SizedBox(height:12),
      TextField(
        controller:drop,
        minLines:1,
        maxLines:3,
        onChanged:_searchDestination,
        decoration:InputDecoration(
          labelText:'Where to?',
          hintText:'Search any address, place, landmark or PIN code',
          border:const OutlineInputBorder(),
          suffixIcon:searching
            ?const Padding(padding:EdgeInsets.all(12),child:SizedBox(width:20,height:20,child:CircularProgressIndicator(strokeWidth:2)))
            :const Icon(Icons.search),
        )
      ),
      if(destinationSuggestions.isNotEmpty)Card(
        margin:const EdgeInsets.only(top:4),
        child:Column(children:[
          ...destinationSuggestions.take(6).map((s)=>ListTile(
            dense:true,
            leading:const Icon(Icons.location_on_outlined,color:orange),
            title:Text(s['mainText']?.toString()??s['text']?.toString()??''),
            subtitle:(s['secondaryText']?.toString()??'').isEmpty?null:Text(s['secondaryText'].toString()),
            onTap:busy?null:()=>_selectDestination(s),
          )),
          const Padding(
            padding:EdgeInsets.fromLTRB(16,4,16,10),
            child:Align(alignment:Alignment.centerLeft,child:Text('Powered by Google',style:TextStyle(fontSize:11,color:muted)))
          ),
        ])
      ),
      const SizedBox(height:12),
      FilledButton.icon(
        onPressed:busy?null:calculate,
        icon:const Icon(Icons.route),
        label:const Text('Calculate fare')
      ),
      if(route.isNotEmpty&&pos!=null)Padding(
        padding:const EdgeInsets.only(top:14),
        child:SizedBox(
          height:240,
          child:FlutterMap(
            options:MapOptions(initialCenter:route.first,initialZoom:13),
            children:[
              TileLayer(urlTemplate:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',userAgentPackageName:'com.gofixo.app'),
              PolylineLayer(polylines:[Polyline(points:route,strokeWidth:5,color:orange)])
            ]
          )
        )
      ),
      if(distance!=null)Card(
        child:ListTile(
          title:Text('Estimated ₹'+fare!.toStringAsFixed(0)),
          subtitle:Text(distance!.toStringAsFixed(1)+' km • '+type.toUpperCase()),
          trailing:FilledButton(onPressed:busy?null:book,child:const Text('Book'))
        )
      ),
    ])
  );
}

class BookingCard extends StatelessWidget{final Session session;final Map<String,dynamic>b;final Future<void> Function()onChanged;const BookingCard({super.key,required this.session,required this.b,required this.onChanged});
  @override Widget build(BuildContext c){final status=b['status']?.toString()??'';final id=int.tryParse(b['id'].toString())??0;final pin=b['start_pin']?.toString();return Card(margin:const EdgeInsets.only(bottom:12),child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Row(children:[Expanded(child:Text('#$id • '+status.toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800))),Text('₹'+(b['fare_amount']??b['estimated_fare']??0).toString())]),
    const SizedBox(height:8),Text(b['pickup_location']?.toString()??''),Text('→ '+(b['drop_or_service_address']?.toString()??''),style:const TextStyle(color:muted)),
    if(pin!=null&&pin.isNotEmpty)Padding(padding:const EdgeInsets.only(top:12),child:Container(width:double.infinity,padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:const Color(0xFFFFF1E6),borderRadius:BorderRadius.circular(12)),child:Text('START PIN  $pin',textAlign:TextAlign.center,style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:orange)))),
    if(b['provider_name']!=null)Padding(padding:const EdgeInsets.only(top:10),child:Text('Partner: '+b['provider_name'].toString())),
    if(status=='accepted'||status=='requested')Align(alignment:Alignment.centerRight,child:TextButton(onPressed:()=>cancel(c,id),child:const Text('Cancel'))),
    if(status=='completed')Align(alignment:Alignment.centerRight,child:FilledButton(onPressed:()=>rate(c,id),child:const Text('Rate partner'))),
  ])));}
  Future<void> cancel(BuildContext c,int id)async{try{await ApiService.cancelBooking(session.token,id);await onChanged();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}}
  Future<void> rate(BuildContext c,int id)async{int rating=5;final comment=TextEditingController();await showDialog(context:c,builder:(_)=>AlertDialog(title:const Text('Rate partner'),content:Column(mainAxisSize:MainAxisSize.min,children:[StatefulBuilder(builder:(c,set)=>DropdownButton<int>(value:rating,items:[1,2,3,4,5].map((x)=>DropdownMenuItem(value:x,child:Text('$x stars'))).toList(),onChanged:(x)=>set(()=>rating=x??5))),TextField(controller:comment,decoration:const InputDecoration(labelText:'Comment'))]),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('Later')),FilledButton(onPressed:()async{await ApiService.rateBooking(session.token,id,rating,comment.text);if(c.mounted)Navigator.pop(c);await onChanged();},child:const Text('Submit'))]));comment.dispose();}
}

class ProviderHome extends StatefulWidget{final Session session;final Future<void> Function() onLogout;const ProviderHome({super.key,required this.session,required this.onLogout});@override State<ProviderHome> createState()=>_ProviderHomeState();}
class _ProviderHomeState extends State<ProviderHome>{
  Map<String,dynamic>? me,sub;List<Map<String,dynamic>> jobs=[];Timer? timer;bool busy=false;
  @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
  @override void dispose(){timer?.cancel();super.dispose();}
  Future<void>load({bool silent=false})async{try{final m=await ApiService.providerMe(widget.session.token);final j=await ApiService.providerBookings(widget.session.token);final id=int.tryParse(m['id']?.toString()??'')??widget.session.userId;final s=id==null?null:await ApiService.subscription(widget.session.token,id);if(m['is_available']==true&&id!=null)await sendLocation(silent:true,providerId:id);if(mounted)setState((){me=m;sub=s;jobs=j;});}catch(e){if(!silent&&mounted)snack(e.toString());}}
  Future<void>sendLocation({bool silent=false,int? providerId})async{try{final id=providerId??int.tryParse(me?['id']?.toString()??'');if(id==null)throw Exception('Provider profile ID is missing');final p=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high));await ApiService.updateProviderLocation(widget.session.token,id,p.latitude,p.longitude);}catch(e){if(!silent&&mounted)snack(e.toString());}}
  void snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
  Future<void>toggle()async{if(me==null)return;setState(()=>busy=true);try{final available=me!['is_available']==true;final id=int.tryParse(me!['id']?.toString()??'');if(id==null)throw Exception('Provider profile ID is missing');if(!available)await sendLocation(providerId:id);final x=await ApiService.setAvailability(widget.session.token,id,!available);if(mounted)setState(()=>me=x);}catch(e){if(mounted)snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
  @override Widget build(BuildContext c){final m=me??{};final status=m['kyc_status']?.toString()??'pending';return Scaffold(appBar:AppBar(title:const Text('Partner dashboard'),actions:[IconButton(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>KycPage(session:widget.session,provider:me??{}))).then((_)=>load()),icon:const Icon(Icons.verified_user)),IconButton(onPressed:()=>showPlans(c),icon:const Icon(Icons.card_membership)),IconButton(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>const AppInfoPage())),tooltip:'App information',icon:const Icon(Icons.settings_outlined)),IconButton(onPressed:widget.onLogout,icon:const Icon(Icons.logout))]),body:RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(16),children:[
    Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(m['name']?.toString()??'',style:const TextStyle(fontSize:22,fontWeight:FontWeight.w800,color:navy)),Text((m['generated_id']??'').toString()),const SizedBox(height:10),Text('KYC: '+status),if(sub!=null)Text('Plan: '+(sub!['plan_name']??'').toString()+' • Earned ₹'+(sub!['total_earned_this_cycle']??0).toString()),const SizedBox(height:12),SwitchListTile(contentPadding:EdgeInsets.zero,title:Text(m['is_available']==true?'ONLINE':'OFFLINE'),subtitle:Text(m['is_available']==true?'Receiving nearby requests':'Tap to go online'),value:m['is_available']==true,onChanged:busy?null:(_)=>toggle())]))),
    if(jobs.any((x)=>x['status']=='requested'))...[
      const Padding(padding:EdgeInsets.only(top:12,bottom:8),child:Text('New requests',style:TextStyle(fontSize:20,fontWeight:FontWeight.w800))),
      ...jobs.where((x)=>x['status']=='requested').map((j)=>JobCard(session:widget.session,b:j,onChanged:load)),
    ],
    const Padding(padding:EdgeInsets.only(top:18,bottom:8),child:Text('My jobs',style:TextStyle(fontSize:20,fontWeight:FontWeight.w800))),
    ...jobs.where((x)=>x['status']!='requested').take(10).map((j)=>JobCard(session:widget.session,b:j,onChanged:load)),
    if(jobs.isEmpty)const Card(child:Padding(padding:EdgeInsets.all(20),child:Text('No active jobs.'))),
   ])));}
  Future<void>showPlans(BuildContext c)async{final plans=await ApiService.plans();if(!c.mounted)return;showModalBottomSheet(context:c,isScrollControlled:true,builder:(_)=>SafeArea(child:ListView(padding:const EdgeInsets.all(16),shrinkWrap:true,children:[const Text('Subscription plans',style:TextStyle(fontSize:22,fontWeight:FontWeight.w800)),...plans.where((p)=>p['provider_type']==me?['type']).map((p)=>Card(child:ListTile(title:Text((p['plan_name']??'Plan').toString().toUpperCase()),subtitle:Text('₹'+p['fee'].toString()+' • cap ₹'+p['earning_cap'].toString()),trailing:FilledButton(onPressed:()async{try{await ApiService.subscribe(widget.session.token,int.parse(p['id'].toString()));if(c.mounted)Navigator.pop(c);await load();}catch(e){snack(e.toString());}},child:const Text('Activate')))))])));}
}

class JobCard extends StatelessWidget{final Session session;final Map<String,dynamic>b;final Future<void> Function()onChanged;const JobCard({super.key,required this.session,required this.b,required this.onChanged});
  @override Widget build(BuildContext c){final id=int.tryParse(b['id'].toString())??0;final status=b['status']?.toString()??'';return Card(margin:const EdgeInsets.only(bottom:10),child:Padding(padding:const EdgeInsets.all(14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Text('#$id • '+status.toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800,color:navy)),const SizedBox(height:7),Text(b['pickup_location']?.toString()??''),Text('→ '+(b['drop_or_service_address']??'').toString(),style:const TextStyle(color:muted)),
    if(b['customer_name']!=null)Text('Customer: '+b['customer_name'].toString()),
    const SizedBox(height:10),
    if(status=='requested')Row(children:[Expanded(child:OutlinedButton(onPressed:()async{await ApiService.declineBooking(session.token,id);await onChanged();},child:const Text('Decline'))),const SizedBox(width:8),Expanded(child:FilledButton(onPressed:()async{try{await ApiService.acceptBooking(session.token,id);await onChanged();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Accept')))]),
    if(status=='accepted')FilledButton(onPressed:()=>start(c,id),child:const Text('Start with customer PIN')),
    if(status=='ongoing')FilledButton(onPressed:()=>finish(c,id,double.tryParse(b['fare_amount']?.toString()??'')??0),child:const Text('Confirm payment / Finish')),
   ])));}
  Future<void>start(BuildContext c,int id)async{final x=TextEditingController();await showDialog(context:c,builder:(_)=>AlertDialog(title:const Text('Enter customer PIN'),content:TextField(controller:x,maxLength:4,keyboardType:TextInputType.number,decoration:const InputDecoration(labelText:'4-digit PIN')),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('Cancel')),FilledButton(onPressed:()async{try{await ApiService.startBooking(session.token,id,x.text.trim());if(c.mounted)Navigator.pop(c);await onChanged();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Start'))]));x.dispose();}
  Future<void>finish(BuildContext c,int id,double current)async{final x=TextEditingController(text:current.toStringAsFixed(0));await showDialog(context:c,builder:(_)=>AlertDialog(title:const Text('Confirm payment'),content:TextField(controller:x,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:const InputDecoration(labelText:'Final fare ₹')),actions:[TextButton(onPressed:()=>Navigator.pop(c),child:const Text('Cancel')),FilledButton(onPressed:()async{final fare=double.tryParse(x.text.trim());if(fare==null||fare<=0)return;try{await ApiService.confirmPayment(session.token,id,fare);if(c.mounted)Navigator.pop(c);await onChanged();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Complete'))]));x.dispose();}
}

class KycPage extends StatefulWidget{
  final Session session;final Map<String,dynamic> provider;
  const KycPage({super.key,required this.session,required this.provider});
  @override State<KycPage> createState()=>_KycPageState();
}
class _KycPageState extends State<KycPage>{
  bool busy=false;
  final docs=<String,String>{
    'aadhar_front':'Aadhar front','aadhar_back':'Aadhar back','driving_license':'Driving license',
    'vehicle_rc':'Vehicle RC','vehicle_photo_front':'Vehicle photo front','vehicle_photo_back':'Vehicle photo back',
    'profile_photo':'Profile photo','police_verification':'Police verification'
  };
  List<String> requiredDocs(){
    final t=widget.provider['type']?.toString()??'bike';
    if(t=='general_worker'||t=='skilled_worker')return ['aadhar_front','aadhar_back','profile_photo','police_verification'];
    return ['aadhar_front','aadhar_back','driving_license','vehicle_rc','vehicle_photo_front','vehicle_photo_back'];
  }
  Future<void>pick(String doc)async{
    final x=await FilePicker.pickFile(type:FileType.custom,allowedExtensions:const['jpg','jpeg','png','webp','pdf']);
    if(x==null||x.path==null)return;
    final providerId=int.tryParse(widget.provider['id']?.toString()??'');if(providerId==null){if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Provider profile ID is missing')));return;}
    if(!mounted)return;
    setState(()=>busy=true);
    try{await ApiService.uploadProviderDocument(widget.session.token,providerId,doc,x.path!);if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Document uploaded')));}
    catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
    finally{if(mounted)setState(()=>busy=false);}
  }
  @override Widget build(BuildContext c){final required=requiredDocs();return Scaffold(appBar:AppBar(title:const Text('KYC documents')),body:ListView(padding:const EdgeInsets.all(16),children:[
    Card(child:Padding(padding:const EdgeInsets.all(16),child:Text('KYC status: '+(widget.provider['kyc_status']??'pending').toString().toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800)))),
    const SizedBox(height:10),const Text('Upload the required documents. Your account can go online after KYC approval and an active subscription.',style:TextStyle(color:muted)),
    const SizedBox(height:12),...required.map((d)=>Card(child:ListTile(leading:const Icon(Icons.description_outlined,color:orange),title:Text(docs[d]??d),trailing:FilledButton(onPressed:busy?null:()=>pick(d),child:const Text('Upload'))))),
   ]));}
}

Future<String> reverse(double lat,double lon)async{try{final u=Uri.https('nominatim.openstreetmap.org','/reverse',{'lat':lat.toString(),'lon':lon.toString(),'format':'json'});final r=await http.get(u,headers:{'User-Agent':'Gofixo/1.0'}).timeout(const Duration(seconds:10));final d=jsonDecode(r.body);return d['display_name']?.toString()??lat.toStringAsFixed(5)+', '+lon.toStringAsFixed(5);}catch(_){return lat.toStringAsFixed(5)+', '+lon.toStringAsFixed(5);}}
Future<LatLng> geocode(String q)async{final u=Uri.https('nominatim.openstreetmap.org','/search',{'q':q,'format':'json','limit':'1','countrycodes':'in'});final r=await http.get(u,headers:{'User-Agent':'Gofixo/1.0'}).timeout(const Duration(seconds:10));if(r.statusCode!=200)throw Exception('Address search failed');final a=jsonDecode(r.body) as List;if(a.isEmpty)throw Exception('Destination not found');return LatLng(double.parse(a[0]['lat'].toString()),double.parse(a[0]['lon'].toString()));}
Future<Map<String,dynamic>> routeFor(double a,double b,double c,double d)async{final u=Uri.parse('https://router.project-osrm.org/route/v1/driving/$b,$a;$d,$c?overview=full&geometries=geojson');final r=await http.get(u).timeout(const Duration(seconds:15));if(r.statusCode!=200)throw Exception('Route service unavailable');final j=jsonDecode(r.body);final routes=j['routes'];if(routes is! List||routes.isEmpty)throw Exception('No drivable route found');final rt=routes.first;final pts=(rt['geometry']['coordinates'] as List).map((p)=>LatLng((p[1] as num).toDouble(),(p[0] as num).toDouble())).toList();return {'distance':rt['distance'],'points':pts};}
