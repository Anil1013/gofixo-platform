import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
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
import 'mobile_reference_ui.dart';

const orange=Color(0xFF12B85F), navy=Color(0xFF172B4D), muted=Color(0xFF64748B);

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
          WidgetsBinding.instance.addPostFrameCallback((_) async {
            final otaApplied = await OtaService.checkAndApply();
            if (!otaApplied && c.mounted) {
              await UpdateService.checkAndPrompt(c);
            }
          });
        }
        final x=s.data;
        if(x==null)return RoleScreen(onLogin:refresh);
        return x.role=='provider'
            ?ReferenceProviderHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();})
            :ReferenceCustomerHome(session:x,onLogout:()async{await ApiService.clearSession();refresh();});
      },
    );
  }
}

class RoleScreen extends StatelessWidget{
  final VoidCallback onLogin;
  const RoleScreen({super.key,required this.onLogin});

  @override
  Widget build(BuildContext c)=>Scaffold(
    backgroundColor:const Color(0xFFF4F7FB),
    appBar:AppBar(
      backgroundColor:Colors.white,
      elevation:0,
      title:const Text('Gofixo',style:TextStyle(fontWeight:FontWeight.w900,color:navy)),
      actions:[
        IconButton(
          tooltip:'App information',
          onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>const AppInfoPage())),
          icon:const Icon(Icons.settings_outlined),
        ),
      ],
    ),
    body:SafeArea(
      child:SingleChildScrollView(
        padding:const EdgeInsets.fromLTRB(14,12,14,28),
        child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
          Container(
            width:double.infinity,
            padding:const EdgeInsets.fromLTRB(18,18,10,12),
            decoration:BoxDecoration(
              gradient:const LinearGradient(
                colors:[Color(0xFF12B85F),Color(0xFF0A9F50)],
                begin:Alignment.topLeft,end:Alignment.bottomRight,
              ),
              borderRadius:BorderRadius.circular(26),
            ),
            child:Row(children:[
              Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                const Text('Gofixo',style:TextStyle(color:Colors.white,fontSize:30,fontWeight:FontWeight.w900)),
                const SizedBox(height:4),
                const Text('Rides & services, right at your doorstep.',style:TextStyle(color:Colors.white,fontSize:15,fontWeight:FontWeight.w600)),
                const SizedBox(height:14),
                FilledButton(
                  style:FilledButton.styleFrom(backgroundColor:Colors.white,foregroundColor:orange),
                  onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'customer',onDone:onLogin))),
                  child:const Text('Book now',style:TextStyle(fontWeight:FontWeight.w800)),
                ),
              ])),
              SizedBox(
                width:128,height:128,
                child:SvgPicture.asset('assets/illustrations/car.svg',fit:BoxFit.contain),
              ),
            ]),
          ),
          const SizedBox(height:18),
          const Text('Choose your ride',style:TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:navy)),
          const SizedBox(height:10),
          Row(children:[
            Expanded(child:_EntryCard(title:'Bike',asset:'bike.svg',onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'customer',onDone:onLogin))))),
            const SizedBox(width:8),
            Expanded(child:_EntryCard(title:'Auto',asset:'auto.svg',onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'customer',onDone:onLogin))))),
            const SizedBox(width:8),
            Expanded(child:_EntryCard(title:'Car',asset:'car.svg',onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'customer',onDone:onLogin))))),
          ]),
          const SizedBox(height:18),
          const Text('Home services',style:TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:navy)),
          const SizedBox(height:10),
          Wrap(spacing:8,runSpacing:8,children:[
            _MiniService('Electrician','electrician.svg'),
            _MiniService('Plumber','plumber.svg'),
            _MiniService('AC service','ac_service.svg'),
            _MiniService('Cleaning','cleaning.svg'),
            _MiniService('Painter','painter.svg'),
            _MiniService('Carpenter','carpenter.svg'),
          ]),
          const SizedBox(height:20),
          Container(
            width:double.infinity,
            padding:const EdgeInsets.all(18),
            decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(22),border:Border.all(color:const Color(0xFFE4E9F1))),
            child:Row(children:[
              Container(width:48,height:48,decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(15)),child:const Icon(Icons.handyman_rounded,color:orange)),
              const SizedBox(width:12),
              const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                Text('Partner with Gofixo',style:TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:navy)),
                SizedBox(height:3),
                Text('Go online, accept jobs and earn.',style:TextStyle(color:muted)),
              ])),
              IconButton(
                onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>Auth(role:'provider',onDone:onLogin))),
                icon:const Icon(Icons.arrow_forward_rounded,color:orange),
              ),
            ]),
          ),
        ]),
      ),
    ),
  );
}

class _EntryCard extends StatelessWidget{
  final String title,asset;final VoidCallback onTap;
  const _EntryCard({required this.title,required this.asset,required this.onTap});
  @override Widget build(BuildContext c)=>InkWell(
    onTap:onTap,borderRadius:BorderRadius.circular(20),
    child:Container(
      height:132,padding:const EdgeInsets.all(8),
      decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),border:Border.all(color:const Color(0xFFE4E9F1))),
      child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
        Expanded(child:SvgPicture.asset('assets/illustrations/$asset',fit:BoxFit.contain)),
        Text(title,style:const TextStyle(fontWeight:FontWeight.w800,color:navy)),
      ]),
    ),
  );
}

class _MiniService extends StatelessWidget{
  final String title,asset;
  const _MiniService(this.title,this.asset);
  @override Widget build(BuildContext c)=>Container(
    width:112,height:96,padding:const EdgeInsets.all(8),
    decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:const Color(0xFFE4E9F1))),
    child:Column(children:[
      Expanded(child:SvgPicture.asset('assets/illustrations/$asset',fit:BoxFit.contain)),
      Text(title,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:navy)),
    ]),
  );
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

class CustomerHome extends StatefulWidget{final Session session;final Future<void> Function() onLogout;const CustomerHome({super.key,required this.session,required this.onLogout});@override State<CustomerHome> createState()=>_CustomerHomeState();}
class _CustomerHomeState extends State<CustomerHome>{
  List<Map<String,dynamic>> bookings=[];Timer? timer;bool loading=true;
  @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
  @override void dispose(){timer?.cancel();super.dispose();}
  Future<void> load({bool silent=false})async{try{final b=await ApiService.customerBookings(widget.session.token);if(mounted)setState((){bookings=b;loading=false;});}catch(e){if(!silent&&mounted)_snack(e.toString());}}
  void _snack(String s){ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));}
  @override Widget build(BuildContext c)=>Scaffold(appBar:AppBar(title:const Text('Gofixo'),actions:[IconButton(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>BookingPage(session:widget.session,onChanged:load))),icon:const Icon(Icons.add_location_alt)),IconButton(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>const AppInfoPage())),tooltip:'App information',icon:const Icon(Icons.settings_outlined)),IconButton(onPressed:widget.onLogout,icon:const Icon(Icons.logout))]),body:loading?const Center(child:CircularProgressIndicator()):RefreshIndicator(onRefresh:load,child:ListView(padding:const EdgeInsets.all(16),children:[
    const Text('Your bookings',style:TextStyle(fontSize:24,fontWeight:FontWeight.w800,color:navy)),const SizedBox(height:12),
    if(bookings.isEmpty)const Card(child:Padding(padding:EdgeInsets.all(24),child:Text('No bookings yet. Tap the location button to book a ride.'))),
    ...bookings.map((b)=>BookingCard(session:widget.session,b:b,onChanged:load)),
   ])));}

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
      bytes.sublist(0,4).map(hex).join(),
      bytes.sublist(4,6).map(hex).join(),
      bytes.sublist(6,8).map(hex).join(),
      bytes.sublist(8,10).map(hex).join(),
      bytes.sublist(10,16).map(hex).join(),
    ].join('-');
  }

  void _searchDestination(String value){
    final hadSelection=selectedDestination!=null;
    selectedDestination=null;
    searchDebounce?.cancel();
    final q=value.trim();
    if(q.length<2){
      placeSessionToken=null;
      if(mounted)setState(()=>destinationSuggestions=[]);
      return;
    }
    if(hadSelection||placeSessionToken==null)placeSessionToken=_newPlaceSessionToken();
    final sessionToken=placeSessionToken;
    searchDebounce=Timer(const Duration(milliseconds:350),()async{
      if(!mounted)return;
      setState(()=>searching=true);
      try{
        final suggestions=await ApiService.placeAutocomplete(q,sessionToken:sessionToken);
        if(mounted&&drop.text.trim()==q)setState(()=>destinationSuggestions=suggestions);
      }catch(_){
        if(mounted&&drop.text.trim()==q)setState(()=>destinationSuggestions=[]);
      }finally{
        if(mounted)setState(()=>searching=false);
      }
    });
  }

  Future<void> _selectDestination(Map<String,dynamic> suggestion)async{
    final placeId=suggestion['placeId']?.toString();
    final fallbackText=suggestion['text']?.toString()??'';
    setState(()=>busy=true);
    try{
      if(placeId!=null&&placeId.isNotEmpty){
        final details=await ApiService.placeDetails(
          placeId,
          sessionToken:placeSessionToken,
        );
        placeSessionToken=null;
        final lat=double.tryParse(details['lat']?.toString()??'');
        final lng=double.tryParse(details['lng']?.toString()??'');
        if(lat==null||lng==null)throw Exception('This location has no map coordinates');
        if(!mounted)return;
        setState((){
          selectedDestination=details;
          drop.text=details['address']?.toString()??fallbackText;
          destinationSuggestions=[];
        });
      }else{
        if(mounted)setState((){
          drop.text=fallbackText;
          destinationSuggestions=[];
        });
      }
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  Future<void> locate()async{
    setState(()=>busy=true);
    try{
      if(!await Geolocator.isLocationServiceEnabled())throw Exception('Please turn on Location Services');
      var p=await Geolocator.checkPermission();
      if(p==LocationPermission.denied)p=await Geolocator.requestPermission();
      if(p==LocationPermission.denied||p==LocationPermission.deniedForever)throw Exception('Location permission is required');
      final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high));
      final addr=await reverse(x.latitude,x.longitude);
      if(mounted)setState((){pos=x;pickup=addr;});
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  Future<void> calculate()async{
    if(pos==null)await locate();
    if(pos==null||drop.text.trim().isEmpty||!mounted)return;
    setState(()=>busy=true);
    try{
      LatLng d;
      String resolvedAddress=drop.text.trim();
      if(selectedDestination!=null){
        final lat=double.tryParse(selectedDestination!['lat']?.toString()??'');
        final lng=double.tryParse(selectedDestination!['lng']?.toString()??'');
        if(lat!=null&&lng!=null)d=LatLng(lat,lng);
        else throw Exception('Selected destination coordinates are invalid');
      }else{
        final place=await ApiService.resolvePlace(resolvedAddress);
        final lat=double.tryParse(place['lat']?.toString()??'');
        final lng=double.tryParse(place['lng']?.toString()??'');
        if(lat==null||lng==null)throw Exception('Destination not found');
        d=LatLng(lat,lng);
        resolvedAddress=place['address']?.toString()??resolvedAddress;
        if(mounted)setState((){
          selectedDestination=place;
          drop.text=resolvedAddress;
          destinationSuggestions=[];
        });
      }
      if(!mounted||pos==null)return;
      final r=await routeFor(pos!.latitude,pos!.longitude,d.latitude,d.longitude);
      if(!mounted)return;
      final km=(r['distance'] as num).toDouble()/1000;
      final rate=type=='bike'?15:type=='auto'?20:25;
      setState((){
        distance=km;
        fare=(km*rate+20).roundToDouble();
        route=(r['points'] as List<LatLng>);
      });
    }catch(e){
      if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));
    }finally{
      if(mounted)setState(()=>busy=false);
    }
  }

  Future<void>book()async{
    if(pos==null||distance==null||fare==null)return;
    setState(()=>busy=true);
    try{
      final destination=selectedDestination?['address']?.toString()??drop.text.trim();
      await ApiService.createBooking(
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
