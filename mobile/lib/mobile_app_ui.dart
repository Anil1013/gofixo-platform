import 'dart:math';
import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/gestures.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:web_socket_channel/web_socket_channel.dart';
import 'package:geolocator/geolocator.dart';
import 'package:geocoding/geocoding.dart';
import 'api_service.dart';

const gfOrange=Color(0xFF12B85F),gfNavy=Color(0xFF10213F),gfMuted=Color(0xFF728097),gfBg=Color(0xFFF4F7FB),gfLine=Color(0xFFE4E9F1),gfGreen=Color(0xFF12B85F);\n\nString gfFormatEta(num? seconds){\n  final s=(seconds??0).round();\n  if(s<=0)return 'ETA unavailable';\n  final minutes=(s/60).ceil();\n  if(minutes<60)return '~$minutes min';\n  final h=minutes~/60, m=minutes%60;\n  return m==0?'~${h}h':'~${h}h ${m}m';\n}\n\nString gfFormatDistance(num? meters){\n  final m=(meters??0).toDouble();\n  if(m<=0)return 'Distance unavailable';\n  if(m<1000)return '${m.round()} m';\n  return '${(m/1000).toStringAsFixed(m<10000?1:0)} km';\n}


class ReferenceCustomerHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceCustomerHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceCustomerHome> createState()=>_ReferenceCustomerHomeState();
}
class _ReferenceCustomerHomeState extends State<ReferenceCustomerHome>{
 List<Map<String,dynamic>> bookings=[];Timer? timer;bool loading=true;int tab=0;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:5),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final b=await ApiService.customerBookings(widget.session.token);if(mounted)setState((){bookings=b;loading=false;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){
  if(loading)return const Scaffold(body:Center(child:CircularProgressIndicator()));
  final pages=<Widget>[
   _CustomerHomeTab(session:widget.session,bookings:bookings,onChanged:load,onTab:(i)=>setState(()=>tab=i)),
   _CustomerBookingsTab(session:widget.session,bookings:bookings,onChanged:load),
   _CustomerServicesTab(session:widget.session,onChanged:load),
   _CustomerWalletTab(bookings:bookings),
   _CustomerProfileTab(session:widget.session,onLogout:widget.onLogout),
  ];
  return Scaffold(backgroundColor:gfBg,body:SafeArea(child:IndexedStack(index:tab,children:pages)),bottomNavigationBar:NavigationBar(
   selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),height:72,backgroundColor:Colors.white,
   indicatorColor:const Color(0xFFEFFFF5),labelBehavior:NavigationDestinationLabelBehavior.alwaysShow,
   destinations:const[
    NavigationDestination(icon:Icon(Icons.home_outlined),selectedIcon:Icon(Icons.home_rounded,color:gfGreen),label:'Home'),
    NavigationDestination(icon:Icon(Icons.receipt_long_outlined),selectedIcon:Icon(Icons.receipt_long_rounded,color:gfGreen),label:'My Bookings'),
    NavigationDestination(icon:Icon(Icons.grid_view_outlined),selectedIcon:Icon(Icons.grid_view_rounded,color:gfGreen),label:'Services'),
    NavigationDestination(icon:Icon(Icons.account_balance_wallet_outlined),selectedIcon:Icon(Icons.account_balance_wallet_rounded,color:gfGreen),label:'Wallet'),
    NavigationDestination(icon:Icon(Icons.person_outline),selectedIcon:Icon(Icons.person_rounded,color:gfGreen),label:'Profile'),
   ],
  ));
 }
}

class ReferenceProviderHome extends StatefulWidget{
 final Session session;final Future<void> Function() onLogout;
 const ReferenceProviderHome({super.key,required this.session,required this.onLogout});
 @override State<ReferenceProviderHome> createState()=>_ReferenceProviderHomeState();
}
class _ReferenceProviderHomeState extends State<ReferenceProviderHome>{
 Map<String,dynamic>? me;List<Map<String,dynamic>> jobs=[];Timer? timer;bool busy=false,locationBusy=false;int tab=0;
 @override void initState(){super.initState();load();timer=Timer.periodic(const Duration(seconds:4),(_)=>load(silent:true));}
 @override void dispose(){timer?.cancel();super.dispose();}
 Future<void> load({bool silent=false})async{try{final m=await ApiService.providerMe(widget.session.token);final j=await ApiService.providerBookings(widget.session.token);final id=int.tryParse(m['id']?.toString()??'');if(m['is_available']==true&&id!=null)await _location(id);if(mounted)setState((){me=m;jobs=j;});}catch(e){if(mounted&&!silent)_snack(e.toString());}}
 Future<void> _location(int id)async{
  if(locationBusy)return;locationBusy=true;
  try{if(!await Geolocator.isLocationServiceEnabled())return;var p=await Geolocator.checkPermission();if(p==LocationPermission.denied)p=await Geolocator.requestPermission();if(p==LocationPermission.denied||p==LocationPermission.deniedForever)return;final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.high,distanceFilter:10));await ApiService.updateProviderLocation(widget.session.token,id,x.latitude,x.longitude);}catch(_){}finally{locationBusy=false;}
 }
 Future<void> toggle()async{
  if(me==null)return;final id=int.tryParse(me!['id']?.toString()??'');if(id==null)return;
  if(me!['kyc_status']!='approved'){_snack('KYC approval is required before going online.');return;}
  setState(()=>busy=true);
  try{if(me!['is_available']==true){final x=await ApiService.setAvailability(widget.session.token,id,false);if(mounted)setState(()=>me=x);}else{await _location(id);final x=await ApiService.setAvailability(widget.session.token,id,true);if(mounted)setState(()=>me=x);}}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}
 }
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override Widget build(BuildContext c){
  final pages=<Widget>[
   _ProviderHomeTab(session:widget.session,me:me??{},jobs:jobs,onChanged:load,onOnline:busy?null:toggle),
   _ProviderJobsTab(session:widget.session,jobs:jobs,onChanged:load),
   _ProviderEarningsTab(me:me??{},jobs:jobs),
   _ProviderServicesTab(me:me??{}),
   _ProviderProfileTab(session:widget.session,me:me??{},onLogout:widget.onLogout),
  ];
  return Scaffold(backgroundColor:gfBg,body:SafeArea(child:IndexedStack(index:tab,children:pages)),bottomNavigationBar:NavigationBar(
   selectedIndex:tab,onDestinationSelected:(i)=>setState(()=>tab=i),height:72,backgroundColor:Colors.white,
   indicatorColor:const Color(0xFFEFFFF5),labelBehavior:NavigationDestinationLabelBehavior.alwaysShow,
   destinations:const[
    NavigationDestination(icon:Icon(Icons.dashboard_outlined),selectedIcon:Icon(Icons.dashboard_rounded,color:gfGreen),label:'Home'),
    NavigationDestination(icon:Icon(Icons.work_outline),selectedIcon:Icon(Icons.work_rounded,color:gfGreen),label:'Jobs'),
    NavigationDestination(icon:Icon(Icons.payments_outlined),selectedIcon:Icon(Icons.payments_rounded,color:gfGreen),label:'Earnings'),
    NavigationDestination(icon:Icon(Icons.handyman_outlined),selectedIcon:Icon(Icons.handyman_rounded,color:gfGreen),label:'Services'),
    NavigationDestination(icon:Icon(Icons.person_outline),selectedIcon:Icon(Icons.person_rounded,color:gfGreen),label:'Profile'),
   ],
  ));
 }
}

class _CustomerHomeTab extends StatelessWidget{
 final Session session;final List<Map<String,dynamic>> bookings;final Future<void> Function({bool silent}) onChanged;final ValueChanged<int> onTab;
 const _CustomerHomeTab({required this.session,required this.bookings,required this.onChanged,required this.onTab});
 @override Widget build(BuildContext c){
  final active=bookings.where((b){final s=b['status']?.toString();return s=='requested'||s=='accepted'||s=='ongoing';}).toList();
  return RefreshIndicator(onRefresh:onChanged,child:ListView(padding:const EdgeInsets.only(bottom:18),children:[
   _CustomerHeader(onProfile:()=>onTab(4)),const SizedBox(height:6),_CustomerHero(session:session,onChanged:onChanged),const SizedBox(height:18),
   _SectionTitle(title:'Book a Ride',onSeeAll:()=>onTab(2)),const SizedBox(height:8),_RideTypeShowcase(session:session,onChanged:onChanged),const SizedBox(height:20),
   _SectionTitle(title:'Home Services',onSeeAll:()=>onTab(2)),const SizedBox(height:8),_Services(onTap:(type,category,label)=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,type:type,serviceCategory:category,serviceDescription:label,onChanged:onChanged)))),
   const SizedBox(height:14),_CustomerPromo(onTap:()=>onTab(2)),const SizedBox(height:18),
   const _SectionTitle(title:'Why Gofixo?'),const SizedBox(height:8),const _CustomerBenefits(),
   if(active.isNotEmpty)...[const SizedBox(height:16),_ActiveBookingStrip(b:active.first,session:session)],
  ]));
 }
}

class _CustomerHeader extends StatelessWidget{
 final VoidCallback onProfile;const _CustomerHeader({required this.onProfile});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.fromLTRB(16,10,12,8),color:Colors.white,child:Row(children:[
  Container(width:43,height:43,decoration:BoxDecoration(color:gfGreen,borderRadius:BorderRadius.circular(14)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:28)),
  const SizedBox(width:9),const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text('Gofixo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:gfNavy,letterSpacing:-.6)),
   Text('Ride · Delivery · Home Services',style:TextStyle(fontSize:8,color:gfMuted,fontWeight:FontWeight.w600))
  ])),
  IconButton(onPressed:(){},icon:const Icon(Icons.notifications_none_rounded,color:gfNavy,size:27)),
  GestureDetector(onTap:onProfile,child:Container(width:41,height:41,decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEAFBF2)),child:const Icon(Icons.person_rounded,color:gfGreen,size:25))),
 ]));
}

class _CustomerHero extends StatelessWidget{
 final Session session; final Future<void> Function({bool silent}) onChanged;
 const _CustomerHero({required this.session,required this.onChanged});
 @override Widget build(BuildContext c){
  return Padding(
   padding:const EdgeInsets.symmetric(horizontal:12),
   child:Column(children:[
    ClipRRect(
     borderRadius:BorderRadius.circular(24),
     child:SizedBox(
      height:245,width:double.infinity,
      child:Stack(fit:StackFit.expand,children:[
       Image.network('https://images.unsplash.com/photo-1519501025264-65ba15a82390?auto=format&fit=crop&w=1200&q=88',fit:BoxFit.cover,errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xFFDCEBFF))),
       DecoratedBox(decoration:BoxDecoration(gradient:LinearGradient(begin:Alignment.topCenter,end:Alignment.bottomCenter,colors:[Colors.transparent,gfNavy.withValues(alpha:.78)]))),
       const Positioned(left:18,top:18,child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text('Your City',style:TextStyle(color:Colors.white,fontSize:27,fontWeight:FontWeight.w900)),
        Text('Your Services',style:TextStyle(color:Color(0xFFFFB03A),fontSize:27,fontWeight:FontWeight.w900)),
        SizedBox(height:4),
        Text('Rides, Home Services\nand more — All in One App',style:TextStyle(color:Colors.white,fontSize:12,fontWeight:FontWeight.w600,height:1.25))
       ])),
       Positioned(left:12,right:12,bottom:12,child:Row(children:[
        _HeroRide('Bike','https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=700&q=88',session,onChanged),
        _HeroRide('Auto','https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=700&q=88',session,onChanged),
        _HeroRide('Car','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=700&q=88',session,onChanged),
       ])),
      ]),
     ),
    ),
    const SizedBox(height:10),
    InkWell(
     onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,onChanged:onChanged))),
     borderRadius:BorderRadius.circular(28),
     child:Container(
      padding:const EdgeInsets.symmetric(horizontal:15,vertical:13),
      decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(28),boxShadow:const[BoxShadow(color:Color(0x18000000),blurRadius:14,offset:Offset(0,5))]),
      child:Row(children:[
       Container(width:37,height:37,decoration:const BoxDecoration(color:Color(0xFFEAFBF2),shape:BoxShape.circle),child:const Icon(Icons.location_on_rounded,color:gfGreen,size:20)),
       const SizedBox(width:10),
       const Expanded(child:Text('Where are you going?',style:TextStyle(fontSize:14,fontWeight:FontWeight.w800,color:gfMuted))),
       Container(width:37,height:37,decoration:const BoxDecoration(color:gfNavy,shape:BoxShape.circle),child:const Icon(Icons.my_location_rounded,color:Colors.white,size:18)),
      ]),
     ),
    ),
   ]),
  );
 }
}
class _HeroRide extends StatelessWidget{
 final String label,url; final Session session; final Future<void> Function({bool silent}) onChanged;
 const _HeroRide(this.label,this.url,this.session,this.onChanged);
 @override Widget build(BuildContext c){
  return Expanded(child:Padding(
   padding:const EdgeInsets.symmetric(horizontal:4),
   child:InkWell(
    onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,type:label.toLowerCase(),onChanged:onChanged))),
    child:Container(
     height:70,
     decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(16),boxShadow:const[BoxShadow(color:Color(0x30000000),blurRadius:8)]),
     child:Stack(children:[
      ClipRRect(borderRadius:BorderRadius.circular(16),child:Image.network(url,fit:BoxFit.cover,width:double.infinity,height:70,errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xFFE8EEF5)))),
      Positioned(left:0,right:0,bottom:0,child:Container(height:24,decoration:BoxDecoration(color:Colors.white.withValues(alpha:.94),borderRadius:const BorderRadius.vertical(bottom:Radius.circular(16))),child:Center(child:Text(label,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy,fontSize:11))))),
     ]),
    ),
   ),
  ));
 }
}

class _SectionTitle extends StatelessWidget{
 final String title;final VoidCallback? onSeeAll;const _SectionTitle({required this.title,this.onSeeAll});
 @override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:Row(crossAxisAlignment:CrossAxisAlignment.center,children:[Expanded(child:Text(title,style:const TextStyle(fontSize:21,fontWeight:FontWeight.w900,color:gfNavy,letterSpacing:-.3))),if(onSeeAll!=null)TextButton(onPressed:onSeeAll,child:const Text('See all  →',style:TextStyle(fontSize:11,fontWeight:FontWeight.w900,color:Color(0xFF1787D8))))]));
}

class _RideTypeShowcase extends StatelessWidget{
 final Session session;final Future<void> Function({bool silent}) onChanged;const _RideTypeShowcase({required this.session,required this.onChanged});
 @override Widget build(BuildContext c)=>SizedBox(height:178,child:ListView(scrollDirection:Axis.horizontal,padding:const EdgeInsets.symmetric(horizontal:12),children:[
  _RideCardNew('Bike','Fast & Affordable','https://images.unsplash.com/photo-1558981806-ec527fa84c39?auto=format&fit=crop&w=700&q=88','bike',session,onChanged),
  _RideCardNew('Auto','Comfortable Rides','https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=700&q=88','auto',session,onChanged),
  _RideCardNew('Car','Spacious & Safe','https://images.unsplash.com/photo-1492144534655-ae79c964c9d7?auto=format&fit=crop&w=700&q=88','car',session,onChanged),
 ]));
}
class _RideCardNew extends StatelessWidget{
 final String title,sub,url,type; final Session session; final Future<void> Function({bool silent}) onChanged;
 const _RideCardNew(this.title,this.sub,this.url,this.type,this.session,this.onChanged);
 @override Widget build(BuildContext c){
  return Padding(
   padding:const EdgeInsets.only(right:10),
   child:SizedBox(
    width:145,
    child:InkWell(
     onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,type:type,onChanged:onChanged))),
     borderRadius:BorderRadius.circular(20),
     child:Container(
      decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(20),boxShadow:const[BoxShadow(color:Color(0x12000000),blurRadius:9,offset:Offset(0,4))]),
      child:Column(children:[
       Expanded(child:ClipRRect(borderRadius:const BorderRadius.vertical(top:Radius.circular(20)),child:Image.network(url,fit:BoxFit.cover,width:double.infinity,errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xFFEAF1F8))))),
       Padding(padding:const EdgeInsets.fromLTRB(6,7,6,8),child:Column(children:[
        Text(title,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
        const SizedBox(height:2),
        Text(sub,style:const TextStyle(fontSize:9,color:gfMuted)),
       ])),
      ]),
     ),
    ),
   ),
  );
 }
}

class _CustomerPromo extends StatelessWidget{
 final VoidCallback onTap;
 const _CustomerPromo({required this.onTap});
 @override Widget build(BuildContext c){
  return Padding(
   padding:const EdgeInsets.symmetric(horizontal:12),
   child:InkWell(
    onTap:onTap,borderRadius:BorderRadius.circular(22),
    child:Container(
     height:138,clipBehavior:Clip.antiAlias,
     decoration:BoxDecoration(color:const Color(0xFFE9FFF4),borderRadius:BorderRadius.circular(22)),
     child:Stack(children:[
      Positioned(right:0,top:0,bottom:0,width:150,child:Image.network('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=700&q=88',fit:BoxFit.cover,errorBuilder:(context,error,stack)=>const ColoredBox(color:Color(0xFFD9F6E7)))),
      Positioned(
       left:16,top:15,bottom:10,right:145,
       child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        const Text('GOFIXO HOME SERVICES',style:TextStyle(fontSize:8,letterSpacing:1.2,fontWeight:FontWeight.w900,color:gfGreen)),
        const SizedBox(height:4),
        const Text('Trusted Professionals\nfor Your Home',style:TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:gfNavy,height:1.05)),
        const SizedBox(height:5),
        const Text('✓ Verified  ✓ Affordable  ✓ On-Time',style:TextStyle(fontSize:8,color:gfGreen)),
        const Spacer(),
        FilledButton(onPressed:onTap,style:FilledButton.styleFrom(backgroundColor:gfGreen,padding:const EdgeInsets.symmetric(horizontal:15,vertical:8),minimumSize:Size.zero),child:const Text('Book Now →',style:TextStyle(fontSize:10,fontWeight:FontWeight.w900))),
       ]),
      ),
     ]),
    ),
   ),
  );
 }
}

class _CustomerBenefits extends StatelessWidget{
 const _CustomerBenefits();@override Widget build(BuildContext c)=>SizedBox(height:102,child:ListView(scrollDirection:Axis.horizontal,padding:const EdgeInsets.symmetric(horizontal:12),children:[
  _Benefit('Verified',Icons.verified_rounded,'Drivers & Experts'),_Benefit('Affordable',Icons.currency_rupee_rounded,'Fair pricing'),_Benefit('On-Time',Icons.schedule_rounded,'Reliable service'),_Benefit('24/7',Icons.support_agent_rounded,'Support')
 ]));
}
class _Benefit extends StatelessWidget{
 final String title,sub;final IconData icon;const _Benefit(this.title,this.icon,this.sub);
 @override Widget build(BuildContext c)=>Container(width:105,margin:const EdgeInsets.only(right:8),padding:const EdgeInsets.all(10),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:gfLine)),child:Column(mainAxisAlignment:MainAxisAlignment.center,children:[
  Container(width:31,height:31,decoration:const BoxDecoration(color:Color(0xFFEAFBF2),shape:BoxShape.circle),child:Icon(icon,color:gfGreen,size:18)),const SizedBox(height:5),Text(title,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w900,color:gfNavy)),Text(sub,textAlign:TextAlign.center,style:const TextStyle(fontSize:7,color:gfMuted))
 ]));
}

class _ActiveBookingStrip extends StatelessWidget{
 final Map<String,dynamic>b;final Session session;const _ActiveBookingStrip({required this.b,required this.session});
 @override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:InkWell(onTap:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:session,booking:b,isProvider:false))),child:Container(padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:gfNavy,borderRadius:BorderRadius.circular(18)),child:Row(children:[
  const Icon(Icons.location_searching,color:gfGreen),const SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   const Text('Live booking',style:TextStyle(color:Colors.white,fontWeight:FontWeight.w900)),Text((b['status']?.toString()??'').toUpperCase()+' · Tap to track',style:const TextStyle(color:Colors.white70,fontSize:10))
  ])),const Icon(Icons.chevron_right,color:Colors.white)
 ]))));
}

class _CustomerBookingsTab extends StatelessWidget{
 final Session session;final List<Map<String,dynamic>> bookings;final Future<void> Function({bool silent}) onChanged;const _CustomerBookingsTab({required this.session,required this.bookings,required this.onChanged});
 @override Widget build(BuildContext c)=>RefreshIndicator(onRefresh:onChanged,child:ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
  const _PageHeading(title:'My Bookings',subtitle:'All rides and home-service requests.'),
  if(bookings.isEmpty)const _Box(child:Text('No bookings yet.')) else ...bookings.map((b)=>_Booking(b:b,session:session,onChanged:onChanged)),
 ]));
}

class _CustomerServicesTab extends StatelessWidget{
 final Session session;final Future<void> Function({bool silent}) onChanged;const _CustomerServicesTab({required this.session,required this.onChanged});
 @override Widget build(BuildContext c)=>ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
  const _PageHeading(title:'Services',subtitle:'Everything Gofixo can do for you.'),
  const _Title(kicker:'RIDES',title:'Choose your ride'),const SizedBox(height:8),_RideTypeShowcase(session:session,onChanged:onChanged),
  const SizedBox(height:16),const _Title(kicker:'HOME SERVICES',title:'Book a professional'),const SizedBox(height:8),
  _Services(onTap:(type,category,label)=>Navigator.push(c,MaterialPageRoute(builder:(_)=>ReferenceBookingPage(session:session,type:type,serviceCategory:category,serviceDescription:label,onChanged:onChanged)))),
 ]);
}

class _CustomerWalletTab extends StatelessWidget{
 final List<Map<String,dynamic>> bookings;const _CustomerWalletTab({required this.bookings});
 @override Widget build(BuildContext c){
  double total=0;int completed=0;
  for(final b in bookings){final s=b['status']?.toString().toLowerCase();if(s=='completed'||s=='paid'||s=='finished'){completed++;total+=double.tryParse((b['fare_amount']??b['final_fare']??b['estimated_fare']??0).toString())??0;}}
  return ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
   const _PageHeading(title:'Wallet',subtitle:'Your real booking payment summary.'),
   Container(padding:const EdgeInsets.all(20),decoration:BoxDecoration(color:gfNavy,borderRadius:BorderRadius.circular(24)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    const Text('TOTAL SPEND',style:TextStyle(color:Colors.white70,fontSize:9,fontWeight:FontWeight.w800)),const SizedBox(height:5),Text('₹'+total.toStringAsFixed(0),style:const TextStyle(color:Colors.white,fontSize:30,fontWeight:FontWeight.w900)),
    const SizedBox(height:12),Row(children:[Expanded(child:_DarkStat('Completed',completed.toString())),const Expanded(child:_DarkStat('Status','Ready'))])
   ])),const SizedBox(height:14),const _Box(child:Text('Summary is calculated from completed booking records.',style:TextStyle(fontSize:11,color:gfMuted)))
  ]);
 }
}

class _DarkStat extends StatelessWidget{final String label,value;const _DarkStat(this.label,this.value);@override Widget build(BuildContext c)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(value,style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w900,fontSize:17)),Text(label,style:const TextStyle(color:Colors.white70,fontSize:10))]);}

class _CustomerProfileTab extends StatelessWidget{
 final Session session;final Future<void> Function() onLogout;const _CustomerProfileTab({required this.session,required this.onLogout});
 @override Widget build(BuildContext c)=>ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
  const _PageHeading(title:'Profile',subtitle:'Manage your Gofixo account.'),_ProfileCard(name:session.userName??'Customer',role:'Customer',icon:Icons.person_rounded),const SizedBox(height:12),
  const _ProfileAction(icon:Icons.security_rounded,title:'Safety & support',subtitle:'Verified partners and live trip tracking.'),
  const _ProfileAction(icon:Icons.location_on_outlined,title:'Location',subtitle:'Used for booking and live trip features.'),
  const _ProfileAction(icon:Icons.info_outline,title:'About Gofixo',subtitle:'Ride · Delivery · Home Services'),const SizedBox(height:12),
  SizedBox(width:double.infinity,child:OutlinedButton.icon(onPressed:onLogout,icon:const Icon(Icons.logout_rounded),label:const Text('Log out')))
 ]);
}

class _ProviderHomeTab extends StatelessWidget{
 final Session session;final Map<String,dynamic> me;final List<Map<String,dynamic>> jobs;final Future<void> Function({bool silent}) onChanged;final VoidCallback? onOnline;
 const _ProviderHomeTab({required this.session,required this.me,required this.jobs,required this.onChanged,required this.onOnline});
 @override Widget build(BuildContext c){
  final requested=jobs.where((j)=>j['status']=='requested').toList();final active=jobs.where((j)=>j['status']=='accepted'||j['status']=='ongoing').toList();
  final rides=int.tryParse(me['today_rides']?.toString()??'')??0;final earned=double.tryParse(me['total_earned_this_cycle']?.toString()??'0')??0;final rating=double.tryParse(me['avg_rating']?.toString()??'0')??0;
  final first=requested.isNotEmpty?requested.first:(active.isNotEmpty?active.first:null);
  return RefreshIndicator(onRefresh:onChanged,child:ListView(padding:const EdgeInsets.only(bottom:18),children:[
   _ProviderHeader(online:me['is_available']==true,onOnline:onOnline),const SizedBox(height:10),
   Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_Partner(m:me)),const SizedBox(height:10),
   Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:Row(children:[
    Expanded(child:_Stat('Today Rides',rides.toString(),Icons.route_rounded)),const SizedBox(width:8),Expanded(child:_Stat('Earnings','₹'+earned.toStringAsFixed(0),Icons.currency_rupee_rounded)),const SizedBox(width:8),Expanded(child:_Stat('Rating',rating==0?'—':rating.toStringAsFixed(1),Icons.star_rounded))
   ])),const SizedBox(height:12),
   const Padding(padding:EdgeInsets.symmetric(horizontal:12),child:_Keep()),const SizedBox(height:16),
   const Padding(padding:EdgeInsets.symmetric(horizontal:12),child:Text('Incoming Bookings',style:TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:gfNavy))),
   const SizedBox(height:8),
   if(requested.isNotEmpty) ...requested.take(2).map((j)=>Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_Incoming(session:session,b:j,changed:onChanged)))
   else if(active.isNotEmpty)...[Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_ProviderMiniMap(b:active.first)),const SizedBox(height:8),Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_Active(session:session,b:active.first,changed:onChanged))]
   else const Padding(padding:EdgeInsets.symmetric(horizontal:12),child:_Waiting()),
   if(first!=null&&requested.isNotEmpty)...[const SizedBox(height:10),Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_ProviderMiniMap(b:first))],
   const SizedBox(height:10),Padding(padding:const EdgeInsets.symmetric(horizontal:12),child:_ProviderOnlineBanner(online:me['is_available']==true,onTap:onOnline)),
  ]));
 }
}
class _ProviderHeader extends StatelessWidget{
 final bool online; final VoidCallback? onOnline;
 const _ProviderHeader({required this.online,required this.onOnline});
 @override Widget build(BuildContext c){
  return Container(
   color:Colors.white,padding:const EdgeInsets.fromLTRB(16,10,14,8),
   child:Row(children:[
    Container(width:43,height:43,decoration:BoxDecoration(color:gfGreen,borderRadius:BorderRadius.circular(14)),child:const Icon(Icons.location_on_rounded,color:Colors.white,size:28)),
    const SizedBox(width:9),
    const Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
     Text('Gofixo',style:TextStyle(fontSize:25,fontWeight:FontWeight.w900,color:gfNavy)),
     Text('Partner · Earn with Gofixo',style:TextStyle(fontSize:9,color:gfMuted,fontWeight:FontWeight.w700))
    ])),
    GestureDetector(onTap:onOnline,child:Container(
     padding:const EdgeInsets.symmetric(horizontal:10,vertical:8),
     decoration:BoxDecoration(color:online?const Color(0xFFE0FAEA):const Color(0xFFF0F3F7),borderRadius:BorderRadius.circular(24)),
     child:Row(children:[
      Text(online?'Online':'Offline',style:TextStyle(fontSize:11,fontWeight:FontWeight.w900,color:online?gfGreen:gfMuted)),
      const SizedBox(width:6),
      Container(width:18,height:18,decoration:BoxDecoration(color:online?gfGreen:Colors.white,shape:BoxShape.circle)),
     ]),
    )),
   ]),
  );
 }
}

class _ProviderMiniMap extends StatefulWidget{
 final Map<String,dynamic>b;const _ProviderMiniMap({required this.b});
 @override State<_ProviderMiniMap> createState()=>_ProviderMiniMapState();
}
class _ProviderMiniMapState extends State<_ProviderMiniMap>{
 GoogleMapController? controller;
 bool touched=false;
 LatLng? pickup;
 LatLng? destination;

 @override Widget build(BuildContext c){
  final pLat=double.tryParse((widget.b['pickup_lat']??widget.b['pickup_latitude'])?.toString()??'');
  final pLng=double.tryParse((widget.b['pickup_lng']??widget.b['pickup_longitude'])?.toString()??'');
  final dLat=double.tryParse((widget.b['drop_lat']??widget.b['drop_latitude'])?.toString()??'');
  final dLng=double.tryParse((widget.b['drop_lng']??widget.b['drop_longitude'])?.toString()??'');
  pickup=(pLat!=null&&pLng!=null)?LatLng(pLat,pLng):null;
  destination=(dLat!=null&&dLng!=null)?LatLng(dLat,dLng):null;
  final center=pickup??destination??const LatLng(28.6139,77.2090);
  final points=<LatLng>[if(pickup!=null)pickup!,if(destination!=null)destination!];

  Future<void> fit() async {
   if(controller==null||points.isEmpty)return;
   try{
    if(points.length==1){
     await controller!.animateCamera(CameraUpdate.newCameraPosition(CameraPosition(target:points.first,zoom:16)));
    }else{
     var minLat=points.first.latitude,maxLat=points.first.latitude,minLng=points.first.longitude,maxLng=points.first.longitude;
     for(final p in points.skip(1)){minLat=min(minLat,p.latitude);maxLat=max(maxLat,p.latitude);minLng=min(minLng,p.longitude);maxLng=max(maxLng,p.longitude);}
     final latPad=(maxLat-minLat).abs()*0.12,lngPad=(maxLng-minLng).abs()*0.12;
     await controller!.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(
       southwest:LatLng(minLat-latPad,minLng-lngPad),northeast:LatLng(maxLat+latPad,maxLng+lngPad)),70));
    }
   }catch(_){}
  }

  return ClipRRect(borderRadius:BorderRadius.circular(22),child:SizedBox(height:245,child:Stack(children:[
   GoogleMap(
    initialCameraPosition:CameraPosition(target:center,zoom:13.8),
    onMapCreated:(m){controller=m;WidgetsBinding.instance.addPostFrameCallback((_)=>fit());},
    onCameraMoveStarted:(){touched=true;},
    gestureRecognizers:<Factory<OneSequenceGestureRecognizer>>{
      Factory<OneSequenceGestureRecognizer>(()=>EagerGestureRecognizer()),
    },
    rotateGesturesEnabled:true,tiltGesturesEnabled:true,scrollGesturesEnabled:true,zoomGesturesEnabled:true,
    markers:{
      if(pickup!=null)Marker(markerId:const MarkerId('pickup'),position:pickup!,infoWindow:const InfoWindow(title:'Customer Pickup')),
      if(destination!=null)Marker(markerId:const MarkerId('destination'),position:destination!,infoWindow:const InfoWindow(title:'Destination')),
    },
    polylines:{
      if(pickup!=null&&destination!=null)Polyline(polylineId:const PolylineId('preview'),points:[pickup!,destination!],width:5,color:gfGreen),
    },
    zoomControlsEnabled:false,myLocationButtonEnabled:false,compassEnabled:true,
   ),
   Positioned(left:12,right:12,top:12,child:Container(padding:const EdgeInsets.all(11),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(15),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:10)]),child:Row(children:[
    const Icon(Icons.navigation_rounded,color:gfGreen,size:20),const SizedBox(width:8),
    Expanded(child:Text(widget.b['pickup_location']?.toString()??'Customer pickup',maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),
    Text((widget.b['distance_km']??'').toString()+' km',style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy))
   ]))),
   Positioned(right:12,bottom:12,child:GestureDetector(onTap:()=>fit(),child:Container(width:40,height:40,decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(13),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:8)]),child:const Icon(Icons.fit_screen,color:gfGreen,size:20)))),
  ])));
 }
}
class _ProviderOnlineBanner extends StatelessWidget{
 final bool online;final VoidCallback? onTap;const _ProviderOnlineBanner({required this.online,required this.onTap});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.fromLTRB(14,12,10,12),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),border:Border.all(color:gfLine)),child:Row(children:[Container(width:10,height:10,decoration:BoxDecoration(color:online?gfGreen:Colors.redAccent,shape:BoxShape.circle)),const SizedBox(width:9),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(online?'You are Online':'You are Offline',style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(online?'Getting ride requests nearby':'Go online to receive nearby jobs',style:const TextStyle(fontSize:9,color:gfMuted))])),FilledButton(onPressed:onTap,style:FilledButton.styleFrom(backgroundColor:online?Colors.redAccent:gfGreen),child:Text(online?'Go Offline':'Go Online'))]));
}

class _ProviderJobsTab extends StatelessWidget{
 final Session session;final List<Map<String,dynamic>> jobs;final Future<void> Function({bool silent}) onChanged;const _ProviderJobsTab({required this.session,required this.jobs,required this.onChanged});
 @override Widget build(BuildContext c)=>RefreshIndicator(onRefresh:onChanged,child:ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
  const _PageHeading(title:'Jobs',subtitle:'Incoming, accepted and completed work.'),
  if(jobs.isEmpty)const _Waiting() else ...jobs.map((j){final s=j['status']?.toString()??'';if(s=='requested')return _Incoming(session:session,b:j,changed:onChanged);if(s=='accepted'||s=='ongoing')return _Active(session:session,b:j,changed:onChanged);return _JobSummary(b:j);}),
 ]));
}

class _JobSummary extends StatelessWidget{
 final Map<String,dynamic>b;const _JobSummary({required this.b});
 @override Widget build(BuildContext c)=>_Box(child:Row(children:[const Icon(Icons.check_circle_outline,color:gfGreen),const SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text((b['status']?.toString()??'').toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(b['drop_or_service_address']?.toString()??'',maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,color:gfMuted))])),Text('₹'+(b['fare_amount']??b['final_fare']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy))]));
}

class _ProviderEarningsTab extends StatelessWidget{
 final Map<String,dynamic> me;final List<Map<String,dynamic>> jobs;const _ProviderEarningsTab({required this.me,required this.jobs});
 @override Widget build(BuildContext c){
  final earned=double.tryParse(me['total_earned_this_cycle']?.toString()??'0')??0;final rides=int.tryParse(me['today_rides']?.toString()??'')??0;final completed=jobs.where((j){final s=j['status']?.toString().toLowerCase();return s=='completed'||s=='paid'||s=='finished';}).length;
  return ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
   const _PageHeading(title:'Earnings',subtitle:'Your provider earnings and completed work.'),
   Container(padding:const EdgeInsets.all(20),decoration:BoxDecoration(color:gfNavy,borderRadius:BorderRadius.circular(24)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    const Text('CURRENT CYCLE',style:TextStyle(color:Colors.white70,fontSize:9,fontWeight:FontWeight.w800)),const SizedBox(height:5),Text('₹'+earned.toStringAsFixed(0),style:const TextStyle(color:Colors.white,fontSize:31,fontWeight:FontWeight.w900)),
    const SizedBox(height:14),Row(children:[Expanded(child:_DarkStat('Today',rides.toString())),Expanded(child:_DarkStat('Completed',completed.toString()))])
   ])),const SizedBox(height:14),const _Box(child:Text('Earnings are read from the provider account data returned by Gofixo.',style:TextStyle(fontSize:11,color:gfMuted)))
  ]);
 }
}

class _ProviderServicesTab extends StatelessWidget{
 final Map<String,dynamic> me;const _ProviderServicesTab({required this.me});
 @override Widget build(BuildContext c){
  final type=(me['type']?.toString()??'partner').replaceAll('_',' ');final approved=me['kyc_status']?.toString()=='approved';
  return ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
   const _PageHeading(title:'Services',subtitle:'Your Gofixo service eligibility.'),
   _Box(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('SERVICE TYPE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),const SizedBox(height:5),Text(type.toUpperCase(),style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:gfNavy)),const SizedBox(height:8),Text(approved?'KYC approved — eligible for matching.':'KYC pending — approval is required before going online.',style:TextStyle(fontSize:11,color:approved?gfGreen:gfMuted,fontWeight:FontWeight.w700))])),
   const SizedBox(height:12),_ServiceInfo(title:'Rides',icon:Icons.local_taxi_rounded,enabled:type=='bike'||type=='auto'||type=='car'),_ServiceInfo(title:'Home services',icon:Icons.handyman_rounded,enabled:type.contains('worker')),_ServiceInfo(title:'Nearby matching',icon:Icons.radar_rounded,enabled:approved),
   const SizedBox(height:12),const _Box(child:Text('Keep your location fresh and subscription active to receive nearby jobs.',style:TextStyle(fontSize:11,color:gfMuted)))
  ]);
 }
}

class _ServiceInfo extends StatelessWidget{
 final String title;final IconData icon;final bool enabled;const _ServiceInfo({required this.title,required this.icon,required this.enabled});
 @override Widget build(BuildContext c)=>Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Row(children:[Icon(icon,color:enabled?gfGreen:gfMuted),const SizedBox(width:10),Expanded(child:Text(title,style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),Text(enabled?'Active':'Not active',style:TextStyle(fontSize:11,fontWeight:FontWeight.w800,color:enabled?gfGreen:gfMuted))]));
}

class _ProviderProfileTab extends StatelessWidget{
 final Session session;final Map<String,dynamic> me;final Future<void> Function() onLogout;const _ProviderProfileTab({required this.session,required this.me,required this.onLogout});
 @override Widget build(BuildContext c){final kyc=me['kyc_status']?.toString()??'pending';return ListView(padding:const EdgeInsets.fromLTRB(12,12,12,24),children:[
  const _PageHeading(title:'Profile',subtitle:'Manage your partner account and compliance.'),_ProfileCard(name:me['name']?.toString()??session.userName??'Partner',role:'Gofixo Partner',icon:Icons.handyman_rounded),const SizedBox(height:12),
  _ProfileAction(icon:Icons.verified_user_rounded,title:'KYC status',subtitle:kyc.toUpperCase()),_ProfileAction(icon:Icons.badge_outlined,title:'Partner ID',subtitle:me['generated_id']?.toString()??'Not assigned'),_ProfileAction(icon:Icons.location_on_outlined,title:'Live location',subtitle:me['is_available']==true?'Updating while online':'Offline'),_ProfileAction(icon:Icons.support_agent,title:'Partner support',subtitle:'Get help with jobs, documents and account access.'),const SizedBox(height:12),
  SizedBox(width:double.infinity,child:OutlinedButton.icon(onPressed:onLogout,icon:const Icon(Icons.logout_rounded),label:const Text('Log out')))
 ]);}
}

class _PageHeading extends StatelessWidget{
 final String title,subtitle;const _PageHeading({required this.title,required this.subtitle});
 @override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.only(bottom:14),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(title,style:const TextStyle(fontSize:27,fontWeight:FontWeight.w900,color:gfNavy)),const SizedBox(height:3),Text(subtitle,style:const TextStyle(fontSize:11,color:gfMuted))]));
}
class _ProfileCard extends StatelessWidget{
 final String name,role;final IconData icon;const _ProfileCard({required this.name,required this.role,required this.icon});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(18),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(22)),child:Row(children:[Container(width:58,height:58,decoration:const BoxDecoration(color:Color(0xFFEFFFF5),shape:BoxShape.circle),child:Icon(icon,color:gfGreen,size:30)),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(name,style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900,color:gfNavy)),Text(role,style:const TextStyle(fontSize:11,color:gfMuted))]))]));
}
class _ProfileAction extends StatelessWidget{
 final IconData icon;final String title,subtitle;const _ProfileAction({required this.icon,required this.title,required this.subtitle});
 @override Widget build(BuildContext c)=>Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(14),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Row(children:[Icon(icon,color:gfGreen),const SizedBox(width:11),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(title,style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy)),Text(subtitle,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:10,color:gfMuted))]))]));
}

class ReferenceBookingPage extends StatefulWidget{
 final Session session;final String type;final String? serviceCategory;final String? serviceDescription;final Future<void> Function({bool silent}) onChanged;
 const ReferenceBookingPage({super.key,required this.session,this.type='bike',this.serviceCategory,this.serviceDescription,required this.onChanged});
 @override State<ReferenceBookingPage> createState()=>_ReferenceBookingPageState();
}
class _ReferenceBookingPageState extends State<ReferenceBookingPage>{
 GoogleMapController? mapController;
 StreamSubscription<Position>? locationSub;
 final dest=TextEditingController();final serviceDesc=TextEditingController();String type='bike',pickup='Detecting your location…';String serviceCategory='other',serviceDescription='';Position? pos;Map<String,dynamic>? place;bool get isService=>type=='general_worker'||type=='skilled_worker';List<Map<String,dynamic>> suggestions=[];Set<Polyline> routePolylines={};LatLng? destinationPoint;double? km,fare;double? routeEtaSeconds;bool busy=false;Timer? debounce;LatLng? lastReversePoint;
 @override void initState(){super.initState();type=widget.type;serviceCategory=widget.serviceCategory??'other';serviceDescription=widget.serviceDescription??'';serviceDesc.text=serviceDescription;WidgetsBinding.instance.addPostFrameCallback((_)=>locate());}
 @override void dispose(){debounce?.cancel();locationSub?.cancel();dest.dispose();serviceDesc.dispose();super.dispose();}
 Future<void>locate()async{if(busy)return;setState(()=>busy=true);try{if(!await Geolocator.isLocationServiceEnabled())throw Exception('Please turn on Location Services.');var p=await Geolocator.checkPermission();if(p==LocationPermission.denied)p=await Geolocator.requestPermission();if(p==LocationPermission.denied||p==LocationPermission.deniedForever)throw Exception('Location permission is required.');Position?best;for(var i=0;i<3;i++){final x=await Geolocator.getCurrentPosition(locationSettings:const LocationSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:0,timeLimit:Duration(seconds:12)));if(best==null||x.accuracy<best.accuracy)best=x;if(x.accuracy<=30)break;}final x=best!;if(x.accuracy>150)throw Exception('GPS accuracy is too weak. Please move outdoors and try again.');final a=await _reverse(x.latitude,x.longitude);if(mounted){setState((){pos=x;pickup=a;lastReversePoint=LatLng(x.latitude,x.longitude);});await _centerMap(LatLng(x.latitude,x.longitude),17);}_startLocationStream();}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 void _startLocationStream(){locationSub?.cancel();locationSub=Geolocator.getPositionStream(locationSettings:const LocationSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:5)).listen((x)async{if(!mounted||x.accuracy>150)return;final point=LatLng(x.latitude,x.longitude);final old=pos;setState(()=>pos=x);if(old==null||Geolocator.distanceBetween(old.latitude,old.longitude,x.latitude,x.longitude)>=3){if(lastReversePoint==null||Geolocator.distanceBetween(lastReversePoint!.latitude,lastReversePoint!.longitude,x.latitude,x.longitude)>=50){final address=await _reverse(x.latitude,x.longitude);if(!mounted)return;setState((){pickup=address;lastReversePoint=point;});}}});}
 void search(String v){debounce?.cancel();place=null;final q=v.trim();if(q.length<2){setState(()=>suggestions=[]);return;}debounce=Timer(const Duration(milliseconds:450),()async{try{final s=await ApiService.placeAutocomplete(q);if(mounted&&dest.text.trim()==q)setState(()=>suggestions=s);}catch(_){try{final points=await locationFromAddress(q);if(points.isNotEmpty&&mounted&&dest.text.trim()==q){final p=points.first;setState(()=>suggestions=[{'type':'native','placeId':'native:${p.latitude},${p.longitude}','text':q,'mainText':q,'secondaryText':'Device address search'}]);}}catch(_){if(mounted&&dest.text.trim()==q)setState(()=>suggestions=[]);}}});}
 Future<void>select(Map<String,dynamic>s)async{final id=s['placeId']?.toString();if(id==null||id.isEmpty)return;setState(()=>busy=true);try{if(id.startsWith('native:')){final parts=id.substring(7).split(',');final lat=double.tryParse(parts.isNotEmpty?parts[0]:'');final lng=double.tryParse(parts.length>1?parts[1]:'');if(lat==null||lng==null)throw Exception('Unable to read the selected address.');final d=<String,dynamic>{'address':s['text']?.toString()??'','lat':lat,'lng':lng};if(mounted){setState((){place=d;dest.text=d['address']?.toString()??'';suggestions=[];destinationPoint=LatLng(lat,lng);});_fitMapToPoints();}return;}Map<String,dynamic> d;try{d=await ApiService.placeDetails(id);}catch(_){final points=await locationFromAddress(s['text']?.toString()??'');if(points.isEmpty)throw Exception('Address service is unavailable. Please try a landmark or PIN code.');final x=points.first;d=<String,dynamic>{'address':s['text']?.toString()??'','lat':x.latitude,'lng':x.longitude};}if(mounted){final lat=double.tryParse(d['lat']?.toString()??'');final lng=double.tryParse(d['lng']?.toString()??'');setState((){place=d;dest.text=d['address']?.toString()??s['text']?.toString()??'';suggestions=[];if(lat!=null&&lng!=null)destinationPoint=LatLng(lat,lng);});if(destinationPoint!=null)_fitMapToPoints();}}catch(e){_snack(e.toString());}finally{if(mounted)setState(()=>busy=false);}}
 Future<void>calculate()async{
  if(pos==null)await locate();
  if(pos==null||dest.text.trim().isEmpty)return;
  setState(()=>busy=true);
  try{
    Map<String,dynamic>p=place??{};
    if(p['lat']==null||p['lng']==null){
      try{
        p=await ApiService.resolvePlace(dest.text.trim());
      }catch(_){
        final points=await locationFromAddress(dest.text.trim());
        if(points.isEmpty)throw Exception('Destination not found. Try a nearby landmark or PIN code.');
        final x=points.first;
        p=<String,dynamic>{'address':dest.text.trim(),'lat':x.latitude,'lng':x.longitude};
      }
    }
    final a=double.tryParse(p['lat']?.toString()??''),b=double.tryParse(p['lng']?.toString()??'');
    if(a==null||b==null)throw Exception('Destination not found.');
    if(isService){
      if(mounted)setState((){
        place=p;
        routePolylines={};
        destinationPoint=LatLng(a,b);
        km=null;
        fare=null;
      });
      WidgetsBinding.instance.addPostFrameCallback((_)=>_fitMapToPoints());
      return;
    }
    final r=await ApiService.computeRoute(pos!.latitude,pos!.longitude,a,b);
    final d=(r['distanceMeters']as num).toDouble()/1000;
    final points=_decodeGooglePolyline(r['encodedPolyline']?.toString()??'');
    if(points.length<2)throw Exception('No route found.');
    if(mounted)setState((){
      place=p;
      km=d;
      fare=_fare(type,d);
      destinationPoint=LatLng(a,b);
      routePolylines={
        Polyline(
          polylineId:const PolylineId('gofixo-route'),
          points:points,
          color:gfGreen,
          width:6,
        )
      };
    });
    WidgetsBinding.instance.addPostFrameCallback((_)=>_fitMapToPoints());
  }catch(e){
    _snack(e.toString());
  }finally{
    if(mounted)setState(()=>busy=false);
  }
}
 Future<void>_centerMap(LatLng p,double zoom)async{try{await mapController?.animateCamera(CameraUpdate.newCameraPosition(CameraPosition(target:p,zoom:zoom)));}catch(_){} }
 Future<void>_zoomIn()async{try{await mapController?.animateCamera(CameraUpdate.zoomIn());}catch(_){}}
 Future<void>_zoomOut()async{try{await mapController?.animateCamera(CameraUpdate.zoomOut());}catch(_){}}
 Future<void>_fitMapToPoints()async{
  final map=mapController;
  if(map==null|| (pos==null&&destinationPoint==null))return;
  try{
   final points=<LatLng>[];
   if(pos!=null)points.add(LatLng(pos!.latitude,pos!.longitude));
   if(destinationPoint!=null)points.add(destinationPoint!);
   for(final polyline in routePolylines)points.addAll(polyline.points);
   if(points.length<2){
    if(destinationPoint!=null)await _centerMap(destinationPoint!,16);
    else if(pos!=null)await _centerMap(LatLng(pos!.latitude,pos!.longitude),16);
    return;
   }
   var minLat=points.first.latitude,maxLat=points.first.latitude,minLng=points.first.longitude,maxLng=points.first.longitude;
   for(final p in points.skip(1)){minLat=min(minLat,p.latitude);maxLat=max(maxLat,p.latitude);minLng=min(minLng,p.longitude);maxLng=max(maxLng,p.longitude);}
   final latPad=(maxLat-minLat).abs()*0.08;
   final lngPad=(maxLng-minLng).abs()*0.08;
   final sw=LatLng(minLat-latPad,minLng-lngPad);
   final ne=LatLng(maxLat+latPad,maxLng+lngPad);
   await map.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(southwest:sw,northeast:ne),90));
  }catch(_){} }
 double _fare(String t,double d){final base=t=='bike'?30:t=='auto'?40:60;final min=base;final slabs=t=='bike'?[[10,6],[20,5.5],[30,5],[50,4.5],[double.infinity,4.5]]:t=='auto'?[[10,7.5],[20,6.5],[30,6],[50,5.5],[double.infinity,5.5]]:[[10,9.5],[20,9],[30,8],[50,6.5],[100,5],[double.infinity,2.5]];var left=d,prev=0.0,total=0.0;for(final x in slabs){final limit=x[0].toDouble(),rate=x[1].toDouble();final take=left<=0?0.0:(left<limit-prev?left:limit-prev);if(take>0)total+=take*rate;left-=take;prev=limit;if(left<=0)break;}return (base+total).clamp(min,double.infinity).roundToDouble();}
 Future<void>book()async{
  if(pos==null)return;
  if(!isService&&(km==null||fare==null))return;
  final address=place?['address']?.toString()??dest.text.trim();
  if(address.trim().isEmpty){_snack('Please enter the destination or service address.');return;}
  setState(()=>busy=true);
  try{
    await ApiService.createBooking(
      widget.session.token,
      providerType:type,
      pickup:pickup,
      drop:address,
      lat:pos!.latitude,
      destinationLat:isService?null:destinationPoint?.latitude,
      destinationLng:isService?null:destinationPoint?.longitude,
      lng:pos!.longitude,
      fare:isService?null:fare,
      distanceKm:isService?null:km,
      serviceType:isService?'services':'ride',
      serviceCategory:isService?serviceCategory:null,
      serviceDescription:isService?serviceDescription:null,
    );
    if(mounted){Navigator.pop(context);await widget.onChanged();}
  }catch(e){_snack(e.toString());}
  finally{if(mounted)setState(()=>busy=false);}
}
 void _snack(String s)=>ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(s.replaceFirst('Exception: ',''))));
 @override
 Widget build(BuildContext c)=>Scaffold(
   backgroundColor:gfBg,
   appBar:AppBar(
     title:Text(isService?'Request service':'Book a ride'),
     backgroundColor:gfBg,
     elevation:0,
   ),
   body:SafeArea(
     child:ListView(
       padding:EdgeInsets.fromLTRB(14,0,14,24+MediaQuery.viewPaddingOf(c).bottom),
       children:[
         if(!isService)
           Row(children:[
             Expanded(child:_Choice('Bike','bike',Icons.two_wheeler,type,(v)=>setState(()=>type=v))),
             const SizedBox(width:7),
             Expanded(child:_Choice('Auto','auto',Icons.electric_rickshaw,type,(v)=>setState(()=>type=v))),
             const SizedBox(width:7),
             Expanded(child:_Choice('Car','car',Icons.directions_car,type,(v)=>setState(()=>type=v))),
           ])
         else
           Container(
             padding:const EdgeInsets.all(14),
             decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),
             child:Text(
               type=='skilled_worker'?'Skilled Expert Service':'Home Help Service',
               style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy),
             ),
           ),
         const SizedBox(height:12),
         _Location(pickup:pickup,onTap:busy?null:locate),
         const SizedBox(height:8),
         ClipRRect(
           borderRadius:BorderRadius.circular(22),
           child:SizedBox(
             height:390,
             child:Stack(
               children:[
                 GoogleMap(
                   initialCameraPosition:CameraPosition(
                     target:pos!=null?LatLng(pos!.latitude,pos!.longitude):const LatLng(28.6139,77.2090),
                     zoom:15,
                   ),
                   onMapCreated:(m){
                     mapController=m;
                     if(destinationPoint!=null){
                       _fitMapToPoints();
                     }else if(pos!=null){
                       _centerMap(LatLng(pos!.latitude,pos!.longitude),16);
                     }
                   },
                   myLocationEnabled:true,
                   myLocationButtonEnabled:false,
                   zoomControlsEnabled:false,
                   compassEnabled:true,
                   rotateGesturesEnabled:true,
                   tiltGesturesEnabled:true,
                   scrollGesturesEnabled:true,
                   zoomGesturesEnabled:true,
                   gestureRecognizers:<Factory<OneSequenceGestureRecognizer>>{
                     Factory<OneSequenceGestureRecognizer>(()=>EagerGestureRecognizer()),
                   },
                   markers:{
                     if(pos!=null)
                       Marker(
                         markerId:const MarkerId('pickup'),
                         position:LatLng(pos!.latitude,pos!.longitude),
                         infoWindow:const InfoWindow(title:'Your location'),
                       ),
                     if(destinationPoint!=null)
                       Marker(
                         markerId:const MarkerId('drop'),
                         position:destinationPoint!,
                         infoWindow:const InfoWindow(title:'Destination'),
                       ),
                   },
                   polylines:routePolylines,
                 ),
                 Positioned(
                   top:12,
                   right:12,
                   child:Column(
                     mainAxisSize:MainAxisSize.min,
                     children:[
                       _MapControl(icon:Icons.add,onTap:_zoomIn),
                       const SizedBox(height:6),
                       _MapControl(icon:Icons.remove,onTap:_zoomOut),
                       if(destinationPoint!=null||routePolylines.isNotEmpty)...[
                         const SizedBox(height:6),
                         _MapControl(icon:Icons.fit_screen,onTap:_fitMapToPoints),
                       ],
                     ],
                   ),
                 ),
               ],
             ),
           ),
         ),
         const SizedBox(height:10),
         TextField(
           controller:dest,
           onChanged:search,
           decoration:InputDecoration(
             filled:true,
             fillColor:Colors.white,
             prefixIcon:const Icon(Icons.search,color:gfGreen),
             labelText:isService?'SERVICE ADDRESS':'WHERE TO?',
             hintText:'Search destination, landmark or PIN code',
             border:OutlineInputBorder(borderRadius:BorderRadius.circular(18)),
           ),
         ),
         const SizedBox(height:10),
         if(suggestions.isNotEmpty)
           Container(
             color:Colors.white,
             child:Column(
               children:suggestions.take(5).map((s)=>ListTile(
                 leading:const Icon(Icons.place,color:gfOrange),
                 title:Text(s['mainText']?.toString()??s['text']?.toString()??''),
                 subtitle:Text(s['secondaryText']?.toString()??''),
                 onTap:busy?null:()=>select(s),
               )).toList(),
             ),
           ),
         if(isService)
           Padding(
             padding:const EdgeInsets.only(bottom:12),
             child:TextField(
               controller:serviceDesc,
               maxLines:3,
               onChanged:(v)=>serviceDescription=v.trim(),
               decoration:InputDecoration(
                 filled:true,fillColor:Colors.white,
                 labelText:'What do you need?',
                 hintText:'Describe the work, issue or service required',
                 prefixIcon:const Icon(Icons.handyman_outlined,color:gfGreen),
                 border:OutlineInputBorder(borderRadius:BorderRadius.circular(18)),
               ),
             ),
           ),
         const SizedBox(height:12),
         FilledButton.icon(
           style:FilledButton.styleFrom(backgroundColor:gfOrange,minimumSize:const Size.fromHeight(52)),
           onPressed:busy?null:calculate,
           icon:Icon(isService?Icons.handyman:Icons.alt_route),
           label:Text(isService?'Request service':'Show route & fare'),
         ),
         if(isService&&place!=null)
           Padding(
             padding:const EdgeInsets.only(top:12),
             child:_Box(
               child:Row(
                 children:[
                   Expanded(
                     child:Column(
                       crossAxisAlignment:CrossAxisAlignment.start,
                       children:[
                         const Text('SERVICE REQUEST',style:TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
                         Text(
                           serviceCategory.replaceAll('_',' ').toUpperCase(),
                           style:const TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy),
                         ),
                         Text(
                           place!['address']?.toString()??dest.text,
                           maxLines:2,
                           overflow:TextOverflow.ellipsis,
                           style:const TextStyle(fontSize:10,color:gfMuted),
                         ),
                       ],
                     ),
                   ),
                   FilledButton(
                     style:FilledButton.styleFrom(backgroundColor:gfGreen),
                     onPressed:busy?null:book,
                     child:const Text('Request'),
                   ),
                 ],
               ),
             ),
           ),
         if(!isService&&fare!=null)
           Padding(
             padding:const EdgeInsets.only(top:12),
             child:Container(
               padding:const EdgeInsets.all(16),
               decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(20)),
               child:Row(
                 children:[
                   Expanded(
                     child:Column(
                       crossAxisAlignment:CrossAxisAlignment.start,
                       children:[
                         const Text('UPFRONT ESTIMATE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
                         Text('₹'+fare!.toStringAsFixed(0),style:const TextStyle(fontSize:28,fontWeight:FontWeight.w900,color:gfNavy)),
                         Text(km!.toStringAsFixed(1)+' km · '+gfFormatEta(routeEtaSeconds)+' · '+type.toUpperCase(),style:const TextStyle(fontSize:11,color:gfMuted)),
                       ],
                     ),
                   ),
                   FilledButton(
                     style:FilledButton.styleFrom(backgroundColor:gfGreen),
                     onPressed:busy?null:book,
                     child:const Text('Confirm ride'),
                   ),
                 ],
               ),
             ),
           ),
       ],
     ),
   ),
 );
}
class _LiveMetric extends StatelessWidget{
  final IconData icon; final String label; final String value;
  const _LiveMetric({required this.icon,required this.label,required this.value});
  @override Widget build(BuildContext c)=>Container(
    padding:const EdgeInsets.symmetric(horizontal:10,vertical:9),
    decoration:BoxDecoration(color:gfBg,borderRadius:BorderRadius.circular(14)),
    child:Row(children:[
      Icon(icon,color:gfGreen,size:19),
      const SizedBox(width:7),
      Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        Text(label,style:const TextStyle(fontSize:9,color:gfMuted,fontWeight:FontWeight.w700)),
        Text(value,style:const TextStyle(fontSize:14,color:gfNavy,fontWeight:FontWeight.w900)),
      ])),
    ]),
  );
}
class _MapControl extends StatelessWidget{
 final IconData icon;final VoidCallback onTap;
 const _MapControl({required this.icon,required this.onTap});
 @override Widget build(BuildContext c)=>Material(color:Colors.white,borderRadius:BorderRadius.circular(12),elevation:3,child:InkWell(onTap:onTap,borderRadius:BorderRadius.circular(12),child:SizedBox(width:44,height:44,child:Icon(icon,color:gfNavy,size:22))));
}
class _Partner extends StatelessWidget{final Map<String,dynamic>m;const _Partner({required this.m});@override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(22)),child:Row(children:[Container(width:58,height:58,padding:const EdgeInsets.all(4),decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:ClipOval(child:Image.network('https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=85',fit:BoxFit.cover,errorBuilder:(_,__,___)=>const Icon(Icons.person,color:gfGreen,size:34)))),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[const Text('PARTNER PROFILE',style:TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),Text(m['name']?.toString()??'Partner',style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900,color:gfNavy)),Text((m['type']?.toString()??'partner').replaceAll('_',' ')+' · '+(m['generated_id']?.toString()??''),style:const TextStyle(fontSize:11,color:gfMuted))])),const Icon(Icons.chevron_right,color:gfMuted)]));}
class _Services extends StatelessWidget{
 final void Function(String type,String category,String label) onTap;
 const _Services({required this.onTap});
 @override Widget build(BuildContext c)=>GridView.count(
   crossAxisCount:4,crossAxisSpacing:7,mainAxisSpacing:9,childAspectRatio:.72,
   shrinkWrap:true,physics:const NeverScrollableScrollPhysics(),
   children:[
    _Service('https://images.unsplash.com/photo-1621905252507-b35492cc74b4?auto=format&fit=crop&w=500&q=80','Electrician',()=>onTap('skilled_worker','electrician','Electrician')),
    _Service('https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?auto=format&fit=crop&w=500&q=80','Plumber',()=>onTap('skilled_worker','plumber','Plumber')),
    _Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','AC Service',()=>onTap('skilled_worker','ac_service','AC Service')),
    _Service('https://images.unsplash.com/photo-1581578731548-c64695cc6952?auto=format&fit=crop&w=500&q=80','Cleaning',()=>onTap('general_worker','cleaning','Cleaning')),
    _Service('https://images.unsplash.com/photo-1562259949-e8e7689d7828?auto=format&fit=crop&w=500&q=80','Painter',()=>onTap('skilled_worker','painter','Painter')),
    _Service('https://images.unsplash.com/photo-1601058268499-e52658a84c9d?auto=format&fit=crop&w=500&q=80','Carpenter',()=>onTap('skilled_worker','carpenter','Carpenter')),
    _Service('https://images.unsplash.com/photo-1581092160607-ee22621dd758?auto=format&fit=crop&w=500&q=80','Appliance Repair',()=>onTap('skilled_worker','appliance_repair','Appliance Repair')),
    _Service('https://images.unsplash.com/photo-1521791055366-0d553872125f?auto=format&fit=crop&w=500&q=80','More Services',()=>onTap('general_worker','other','Other')),
   ],
 );
}
class _Service extends StatelessWidget {
  final String url;
  final String label;
  final VoidCallback tap;
  const _Service(this.url, this.label, this.tap);
  @override
  Widget build(BuildContext c) {
    return InkWell(
      onTap: tap,
      borderRadius: BorderRadius.circular(16),
      child: Container(
        padding: const EdgeInsets.all(5),
        decoration: BoxDecoration(
          color: Colors.white,
          border: Border.all(color: gfLine),
          borderRadius: BorderRadius.circular(16),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Expanded(
              child: ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.network(
                  url,
                  fit: BoxFit.cover,
                  width: double.infinity,
                  errorBuilder: (_, __, ___) => const ColoredBox(
                    color: Color(0xFFE8EEF5),
                    child: Icon(Icons.handyman_outlined),
                  ),
                ),
              ),
            ),
            const SizedBox(height: 4),
            Text(
              label,
              textAlign: TextAlign.center,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: const TextStyle(fontSize: 8, fontWeight: FontWeight.w900, color: gfNavy),
            ),
          ],
        ),
      ),
    );
  }
}

class _Choice extends StatelessWidget{final String label,value;final IconData icon;final String selected;final ValueChanged<String>onTap;const _Choice(this.label,this.value,this.icon,this.selected,this.onTap);String get _url=>value=='bike'?'https://images.unsplash.com/photo-1679465427762-38cfdba8e2fb?auto=format&fit=crop&w=900&q=85':value=='auto'?'https://images.unsplash.com/photo-1626149637281-4e227308da18?auto=format&fit=crop&w=900&q=85':'https://images.unsplash.com/photo-1685019718640-6e562edc365e?auto=format&fit=crop&w=900&q=85';@override Widget build(BuildContext c)=>InkWell(onTap:()=>onTap(value),borderRadius:BorderRadius.circular(15),child:Container(height:112,padding:const EdgeInsets.all(6),decoration:BoxDecoration(color:selected==value?const Color(0xFFEFFFF5):Colors.white,border:Border.all(color:selected==value?gfGreen:gfLine,width:selected==value?1.5:1),borderRadius:BorderRadius.circular(15)),child:Column(children:[Expanded(child:ClipRRect(borderRadius:BorderRadius.circular(11),child:Image.network(_url,fit:BoxFit.cover,width:double.infinity,errorBuilder:(_,__,___)=>Icon(icon,color:gfGreen,size:30)))),Text(label,style:TextStyle(fontSize:10,fontWeight:FontWeight.w900,color:selected==value?gfGreen:gfNavy))])));}
class _Title extends StatelessWidget{
 final String kicker,title;
 const _Title({required this.kicker,required this.title});
 @override Widget build(BuildContext c)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
  Text(kicker,style:const TextStyle(fontSize:8,letterSpacing:1.5,fontWeight:FontWeight.w900,color:gfGreen)),
  Text(title,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:gfNavy))
 ]);
}
class _Stat extends StatelessWidget{
 final String label,value; final IconData icon;
 const _Stat(this.label,this.value,this.icon);
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.symmetric(vertical:13,horizontal:5),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(17)),child:Column(children:[
  Icon(icon,color:gfGreen,size:18),const SizedBox(height:4),Text(value,maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),Text(label,textAlign:TextAlign.center,style:const TextStyle(fontSize:8,color:gfMuted))
 ]));
}
class _Keep extends StatelessWidget{
 const _Keep();
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(15),decoration:BoxDecoration(color:const Color(0xFFFFF7E8),borderRadius:BorderRadius.circular(20)),child:const Row(children:[
  Text('🏆',style:TextStyle(fontSize:24)),SizedBox(width:10),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text('Keep Going!',style:TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
   Text('Stay online and accept nearby jobs to grow your earnings.',style:TextStyle(fontSize:10,color:gfMuted))
  ]))
 ]));
}
class _Waiting extends StatelessWidget{
 const _Waiting();
 @override Widget build(BuildContext c)=>_Box(child:Column(children:const[
  Icon(Icons.radar,color:gfGreen,size:35),SizedBox(height:7),
  Text('Waiting for your next ride',style:TextStyle(fontWeight:FontWeight.w800,color:gfNavy)),
  Text('Stay online and nearby requests will appear here.',style:TextStyle(fontSize:10,color:gfMuted))
 ]));
}
class _Incoming extends StatelessWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent}) changed;
 const _Incoming({required this.session,required this.b,required this.changed});
 @override Widget build(BuildContext c){
  final id=int.tryParse(b['id']?.toString()??'')??0;final isService=b['service_type']=='services';
  return _Box(child:Column(children:[
   Row(children:[Icon(isService?Icons.handyman_outlined:Icons.notifications_active,color:gfGreen),const SizedBox(width:7),Expanded(child:Text(isService?'New service request':'New ride request',style:const TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy))),Text('₹'+(b['fare_amount']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   if(isService)...[
     const SizedBox(height:6),
     Align(alignment:Alignment.centerLeft,child:Text((b['service_category']?.toString()??'other').replaceAll('_',' ').toUpperCase(),style:const TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen))),
     Align(alignment:Alignment.centerLeft,child:Text(b['service_description']?.toString()??'',maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,color:gfMuted))),
   ],
   const SizedBox(height:10),_Route('Pickup',b['pickup_location']?.toString()??''),_Route(isService?'Service address':'Drop',b['drop_or_service_address']?.toString()??''),const SizedBox(height:10),
   Row(children:[
    Expanded(child:OutlinedButton(onPressed:()async{await ApiService.declineBooking(session.token,id);await changed();},child:const Text('Reject'))),
    const SizedBox(width:8),
    Expanded(child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:()async{try{await ApiService.acceptBooking(session.token,id);await changed();}catch(e){ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}},child:const Text('Accept')))
   ])
  ]));
 }
}
class _Active extends StatefulWidget{
 final Session session; final Map<String,dynamic>b; final Future<void> Function({bool silent})changed;
 const _Active({required this.session,required this.b,required this.changed});
 @override State<_Active> createState()=>_ActiveState();
}
class _ActiveState extends State<_Active>{
 final pin=TextEditingController(); final fare=TextEditingController(); bool submitting=false;
 @override void initState(){super.initState();fare.text=widget.b['fare_amount']?.toString()??'';}
 @override void dispose(){pin.dispose();fare.dispose();super.dispose();}
 @override Widget build(BuildContext c){
  final id=int.tryParse(widget.b['id']?.toString()??'')??0;final ongoing=widget.b['status']=='ongoing';
  return _Box(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Text(ongoing?'TRIP IN PROGRESS':'ON THE WAY',style:const TextStyle(fontSize:9,fontWeight:FontWeight.w800,color:gfGreen)),
   const SizedBox(height:4),Text(ongoing?'Confirm payment to complete':'Start with customer PIN',style:const TextStyle(fontSize:18,fontWeight:FontWeight.w900,color:gfNavy)),
   const SizedBox(height:10),_Route('Pickup',widget.b['pickup_location']?.toString()??''),
   if(!ongoing)TextField(controller:pin,maxLength:4,keyboardType:TextInputType.number,onChanged:(_)=>setState((){}),decoration:const InputDecoration(labelText:'Customer 4-digit PIN')),
   if(!ongoing)SizedBox(width:double.infinity,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:pin.text.length==4?()async{try{await ApiService.startBooking(widget.session.token,id,pin.text);await widget.changed();}catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}}:null,child:const Text('Start trip →'))),
   if(ongoing)TextField(controller:fare,keyboardType:const TextInputType.numberWithOptions(decimal:true),decoration:const InputDecoration(labelText:'Final fare ₹')),
   if(ongoing)SizedBox(width:double.infinity,child:FilledButton(style:FilledButton.styleFrom(backgroundColor:gfGreen),onPressed:submitting?null:()async{
      final value=double.tryParse(fare.text.trim());
      if(value==null||value<=0){ScaffoldMessenger.of(c).showSnackBar(const SnackBar(content:Text('Enter a valid final fare.')));return;}
      setState(()=>submitting=true);
      try{await ApiService.confirmPayment(widget.session.token,id,value);await widget.changed();}
      catch(e){if(mounted)ScaffoldMessenger.of(c).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}
      finally{if(mounted)setState(()=>submitting=false);}
    },child:Text(submitting?'Saving…':'Confirm payment received →'))),
   const SizedBox(height:6),
   OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:widget.session,booking:widget.b,isProvider:true))),icon:const Icon(Icons.map_outlined),label:const Text('Open live map'))
  ]));
 }
}
class _Booking extends StatelessWidget{
 final Map<String,dynamic>b; final Session session; final Future<void> Function({bool silent})onChanged;
 const _Booking({required this.b,required this.session,required this.onChanged});
 @override Widget build(BuildContext c){
  final s=b['status']?.toString()??'';final id=b['id']?.toString()??'';final isService=b['service_type']=='services';
  return Container(margin:const EdgeInsets.only(bottom:8),padding:const EdgeInsets.all(13),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   Row(children:[Expanded(child:Text('#'+id+' · '+s.toUpperCase(),style:const TextStyle(fontWeight:FontWeight.w800,color:gfNavy))),Text('₹'+(b['fare_amount']??b['estimated_fare']??0).toString(),style:const TextStyle(fontWeight:FontWeight.w900))]),
   if(isService)Text((b['service_category']?.toString()??'other').replaceAll('_',' ').toUpperCase(),style:const TextStyle(fontSize:9,fontWeight:FontWeight.w900,color:gfGreen)),
   if(isService)Text(b['service_description']?.toString()??'',maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:gfMuted)),
   Text(b['pickup_location']?.toString()??'',maxLines:1,overflow:TextOverflow.ellipsis),
   Text((isService?'Service address: ':'→ ')+(b['drop_or_service_address']?.toString()??''),maxLines:1,overflow:TextOverflow.ellipsis,style:const TextStyle(color:gfMuted)),
   if(s=='requested'||s=='accepted')Align(alignment:Alignment.centerRight,child:TextButton(onPressed:()async{await ApiService.cancelBooking(session.token,int.tryParse(id)??0);await onChanged();},child:const Text('Cancel'))),
   if(s=='accepted'||s=='ongoing')Align(alignment:Alignment.centerRight,child:OutlinedButton.icon(onPressed:()=>Navigator.push(c,MaterialPageRoute(builder:(_)=>LiveTrackingPage(session:session,booking:b,isProvider:false))),icon:const Icon(Icons.location_searching),label:const Text('Track live')))
  ]));
 }
}
class CompletedRidesPage extends StatefulWidget{
 final Session session;
 final List<Map<String,dynamic>> bookings;
 final Future<void> Function() onRefresh;
 const CompletedRidesPage({super.key,required this.session,required this.bookings,required this.onRefresh});
 @override State<CompletedRidesPage> createState()=>_CompletedRidesPageState();
}

class _CompletedRidesPageState extends State<CompletedRidesPage>{
 late List<Map<String,dynamic>> bookings;
 bool loading=false;

 @override void initState(){
  super.initState();
  bookings=List<Map<String,dynamic>>.from(widget.bookings);
 }

 List<Map<String,dynamic>> get completed=>bookings.where((b){
  final status=b['status']?.toString().toLowerCase().trim()??'';
  final serviceType=b['service_type']?.toString().toLowerCase().trim()??'ride';
  return serviceType!='services'&&
    (status=='completed'||status=='finished'||status=='paid');
 }).toList();

 Future<void>refresh()async{
  if(loading)return;
  setState(()=>loading=true);
  try{
   final latest=await ApiService.customerBookings(widget.session.token);
   if(mounted)setState(()=>bookings=latest);
   await widget.onRefresh();
  }catch(e){
   if(mounted)ScaffoldMessenger.of(context).showSnackBar(
    SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))),
   );
  }finally{
   if(mounted)setState(()=>loading=false);
  }
 }

 @override Widget build(BuildContext c)=>Scaffold(
  backgroundColor:gfBg,
  appBar:AppBar(
   title:const Text('Completed rides',style:TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
   backgroundColor:gfBg,
   elevation:0,
   actions:[
    IconButton(
     onPressed:loading?null:refresh,
     icon:loading
       ?const SizedBox(width:20,height:20,child:CircularProgressIndicator(strokeWidth:2))
       :const Icon(Icons.refresh_rounded),
    ),
   ],
  ),
  body:RefreshIndicator(
   onRefresh:refresh,
   child:ListView(
    padding:const EdgeInsets.fromLTRB(14,8,14,28),
    children:[
     Container(
      padding:const EdgeInsets.all(18),
      decoration:BoxDecoration(
       color:gfNavy,
       borderRadius:BorderRadius.circular(22),
      ),
      child:Row(children:[
       Container(
        width:48,height:48,
        decoration:BoxDecoration(color:gfGreen.withOpacity(.16),shape:BoxShape.circle),
        child:const Icon(Icons.check_circle_rounded,color:gfGreen,size:28),
       ),
       const SizedBox(width:12),
       Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
        const Text('Your completed rides',style:TextStyle(color:Colors.white,fontSize:17,fontWeight:FontWeight.w900)),
        Text('${completed.length} completed ride${completed.length==1?'':'s'}',style:const TextStyle(color:Colors.white70,fontSize:12)),
       ])),
      ]),
     ),
     const SizedBox(height:14),
     if(completed.isEmpty)
      const _Box(child:Column(children:[
       Icon(Icons.history_rounded,color:gfMuted,size:42),
       SizedBox(height:8),
       Text('No completed rides yet',style:TextStyle(fontSize:16,fontWeight:FontWeight.w900,color:gfNavy)),
       SizedBox(height:4),
       Text('Your finished bike, auto and car rides will appear here.',textAlign:TextAlign.center,style:TextStyle(fontSize:11,color:gfMuted)),
      ]))
     else
      ...completed.map((b)=>_CompletedRideCard(b:b)),
    ],
   ),
  ),
 );
}

class _CompletedRideCard extends StatelessWidget{
 final Map<String,dynamic>b;
 const _CompletedRideCard({required this.b});

 @override Widget build(BuildContext c){
  final id=b['id']?.toString()??'';
  final fare=b['fare_amount']??b['final_fare']??b['estimated_fare']??0;
  final type=(b['provider_type']?.toString()??'ride').toUpperCase();
  final date=b['completed_at']??b['updated_at']??b['created_at'];
  return Container(
   margin:const EdgeInsets.only(bottom:10),
   padding:const EdgeInsets.all(15),
   decoration:BoxDecoration(
    color:Colors.white,
    border:Border.all(color:gfLine),
    borderRadius:BorderRadius.circular(20),
   ),
   child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
    Row(children:[
     Container(
      width:42,height:42,
      decoration:BoxDecoration(color:const Color(0xFFEFFFF5),borderRadius:BorderRadius.circular(13)),
      child:Icon(
       type=='BIKE'?Icons.two_wheeler:type=='AUTO'?Icons.electric_rickshaw:Icons.directions_car,
       color:gfGreen,
      ),
     ),
     const SizedBox(width:10),
     Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
      Text(type,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w900,color:gfNavy)),
      if(id.isNotEmpty)Text('#$id',style:const TextStyle(fontSize:10,color:gfMuted)),
     ])),
     Text('₹${fare.toString()}',style:const TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:gfNavy)),
    ]),
    const SizedBox(height:12),
    _Route('Pickup',b['pickup_location']?.toString()??''),
    _Route('Drop',b['drop_or_service_address']?.toString()??''),
    if(date!=null&&date.toString().isNotEmpty)
     Padding(
      padding:const EdgeInsets.only(top:2),
      child:Text(_dateText(date),style:const TextStyle(fontSize:10,color:gfMuted)),
     ),
   ]),
  );
 }

 static String _dateText(dynamic value){
  final raw=value.toString();
  final d=DateTime.tryParse(raw)?.toLocal();
  if(d==null)return raw;
  String two(int n)=>n.toString().padLeft(2,'0');
  return '${two(d.day)}/${two(d.month)}/${d.year} · ${two(d.hour)}:${two(d.minute)}';
 }
}

class _Box extends StatelessWidget{
 final Widget child; const _Box({required this.child});
 @override Widget build(BuildContext c)=>Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:Colors.white,border:Border.all(color:gfLine),borderRadius:BorderRadius.circular(20)),child:child);
}
class _Location extends StatelessWidget{
 final String pickup; final VoidCallback? onTap;
 const _Location({required this.pickup,required this.onTap});
 @override Widget build(BuildContext c)=>_Box(child:Row(children:[
  const Icon(Icons.my_location,color:gfGreen),const SizedBox(width:9),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
   const Text('PICKUP',style:TextStyle(fontSize:8,fontWeight:FontWeight.w800,color:gfMuted)),
   Text(pickup,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:12,fontWeight:FontWeight.w700,color:gfNavy))
  ])),IconButton(onPressed:onTap,icon:const Icon(Icons.gps_fixed,color:gfGreen))
 ]));
}
class _Route extends StatelessWidget{final String label,value;const _Route(this.label,this.value);@override Widget build(BuildContext c)=>Padding(padding:const EdgeInsets.only(bottom:7),child:Row(children:[Icon(label=='Pickup'?Icons.my_location:Icons.location_on,color:label=='Pickup'?gfGreen:gfOrange,size:17),const SizedBox(width:7),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label.toUpperCase(),style:const TextStyle(fontSize:7,color:gfMuted,fontWeight:FontWeight.w800)),Text(value,maxLines:2,overflow:TextOverflow.ellipsis,style:const TextStyle(fontSize:11,fontWeight:FontWeight.w700,color:gfNavy))]))]));}
Future<String> _reverse(double lat,double lon)async{try{final marks=await placemarkFromCoordinates(lat,lon);if(marks.isNotEmpty){final p=marks.first;final values=<String?>[p.name,p.street,p.subLocality,p.locality,p.subAdministrativeArea,p.administrativeArea,p.postalCode,p.country];final parts=values.whereType<String>().map((v)=>v.trim()).where((v)=>v.isNotEmpty).toList();final out=<String>[];for(final part in parts){if(!out.any((x)=>x.toLowerCase()==part.toLowerCase()))out.add(part);}if(out.isNotEmpty)return out.join(', ');}}catch(_){ }return '$lat, $lon';}
List<LatLng> _decodeGooglePolyline(String encoded){final points=<LatLng>[];var index=0;var lat=0;var lng=0;while(index<encoded.length){var result=0;var shift=0;int b;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lat+=((result&1)!=0?~(result>>1):(result>>1));result=0;shift=0;do{b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32&&index<encoded.length);lng+=((result&1)!=0?~(result>>1):(result>>1));points.add(LatLng(lat/1e5,lng/1e5));}return points;}



class LiveTrackingPage extends StatefulWidget{
  final Session session;
  final Map<String,dynamic> booking;
  final bool isProvider;
  const LiveTrackingPage({super.key,required this.session,required this.booking,required this.isProvider});
  @override State<LiveTrackingPage> createState()=>_LiveTrackingPageState();
}
class _LiveTrackingPageState extends State<LiveTrackingPage>{
  WebSocketChannel? channel;
  StreamSubscription<Position>? gpsSub;
  Timer? reconnectTimer;
  Timer? pollTimer;
  Timer? routeTimer;
  LatLng? providerPoint;
  LatLng? pickupPoint;
  LatLng? destinationPoint;
  LatLng? lastRoutedPoint;
  Set<Polyline> routeLines={};
  String status='';
  bool connecting=false;
  bool followCamera=true;
  bool movingCamera=false;

  @override void initState(){
    super.initState();
    status=widget.booking['status']?.toString()??'';
    final plat=double.tryParse(widget.booking['pickup_lat']?.toString()??'');
    final plng=double.tryParse(widget.booking['pickup_lng']?.toString()??'');
    if(plat!=null&&plng!=null)pickupPoint=LatLng(plat,plng);
    final dlat=double.tryParse((widget.booking['drop_lat']??widget.booking['drop_latitude'])?.toString()??'');
    final dlng=double.tryParse((widget.booking['drop_lng']??widget.booking['drop_longitude'])?.toString()??'');
    if(dlat!=null&&dlng!=null)destinationPoint=LatLng(dlat,dlng);
    final vlat=double.tryParse(widget.booking['provider_lat']?.toString()??'');
    final vlng=double.tryParse(widget.booking['provider_lng']?.toString()??'');
    if(vlat!=null&&vlng!=null)providerPoint=LatLng(vlat,vlng);
    if(widget.isProvider){
      _startProviderGps();
      routeTimer=Timer.periodic(const Duration(seconds:20),(_)=>_refreshRoute());
      _refreshRoute();
    }else{
      _connectRealtime();
      _startBookingPoll();
      routeTimer=Timer.periodic(const Duration(seconds:20),(_)=>_refreshRoute());
      _refreshRoute();
    }
  }

  @override void dispose(){
    gpsSub?.cancel();
    pollTimer?.cancel();
    routeTimer?.cancel();
    reconnectTimer?.cancel();
    channel?.sink.close();
    super.dispose();
  }

  void _connectRealtime(){
    if(connecting||!mounted)return;
    connecting=true;
    try{
      final ch=ApiService.realtimeChannel(widget.session.token);
      channel=ch;
      ch.sink.add(jsonEncode({'type':'subscribe_booking','booking_id':widget.booking['id']}));
      ch.stream.listen((raw){
        try{
          final d=jsonDecode(raw.toString());
          if(d is Map&&d['type']=='provider_location'){
            final lat=double.tryParse(d['lat']?.toString()??'');
            final lng=double.tryParse(d['lng']?.toString()??'');
            if(lat!=null&&lng!=null&&mounted){
              setState(()=>providerPoint=LatLng(lat,lng));
              _followProvider();
            }
          }
        }catch(_){}
      },onDone:_scheduleReconnect,onError:(_,__)=>_scheduleReconnect());
    }catch(_){
      _scheduleReconnect();
    }finally{
      connecting=false;
    }
  }

  void _scheduleReconnect(){
    if(!mounted||reconnectTimer?.isActive==true)return;
    reconnectTimer=Timer(const Duration(seconds:3),(){reconnectTimer=null;_connectRealtime();});
  }

  void _startBookingPoll(){
    pollTimer=Timer.periodic(const Duration(seconds:5),(_)=>_refreshBooking());
  }

  Future<void>_refreshBooking()async{
    try{
      final all=await ApiService.customerBookings(widget.session.token);
      final id=widget.booking['id']?.toString();
      Map<String,dynamic>? b;
      for(final x in all){if(x['id']?.toString()==id){b=x;break;}}
      if(b==null||!mounted)return;
      final lat=double.tryParse(b['provider_lat']?.toString()??'');
      final lng=double.tryParse(b['provider_lng']?.toString()??'');
      setState((){
        status=b!['status']?.toString()??status;
        if(lat!=null&&lng!=null)providerPoint=LatLng(lat,lng);
      });
      if(status=='completed'||status=='cancelled'||status=='no_provider'){
        await channel?.sink.close();
      }
      _followProvider();
    }catch(_){}
  }

  void _startProviderGps(){
    gpsSub?.cancel();
    gpsSub=Geolocator.getPositionStream(locationSettings:const LocationSettings(accuracy:LocationAccuracy.bestForNavigation,distanceFilter:5)).listen((x){
      if(!mounted||x.accuracy>150)return;
      setState(()=>providerPoint=LatLng(x.latitude,x.longitude));
    });
  }

  Future<void>_refreshRoute()async{
    if(providerPoint==null)return;
    final p=providerPoint!;
    final target=(status=='ongoing'&&destinationPoint!=null)?destinationPoint:pickupPoint;
    if(target==null)return;
    if(lastRoutedPoint!=null&&Geolocator.distanceBetween(lastRoutedPoint!.latitude,lastRoutedPoint!.longitude,p.latitude,p.longitude)<100)return;
    try{
      final r=await ApiService.computeRoute(p.latitude,p.longitude,target.latitude,target.longitude);
      final pts=_decodeGooglePolyline(r['encodedPolyline']?.toString()??'');
      if(pts.length>=2&&mounted){
        setState(()=>routeLines={Polyline(polylineId:const PolylineId('partner-route'),points:pts,color:gfGreen,width:5)});
        lastRoutedPoint=p;
      }
    }catch(_){}
  }

  List<LatLng>_decodeGooglePolyline(String encoded){
    final points=<LatLng>[];var index=0,lat=0,lng=0;
    while(index<encoded.length){
      var result=0,shift=0;int b;
      do{if(index>=encoded.length)return points;b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
      lat+=((result&1)!=0?~(result>>1):(result>>1));
      result=0;shift=0;
      do{if(index>=encoded.length)return points;b=encoded.codeUnitAt(index++)-63;result|=(b&31)<<shift;shift+=5;}while(b>=32);
      lng+=((result&1)!=0?~(result>>1):(result>>1));
      points.add(LatLng(lat/1e5,lng/1e5));
    }
    return points;
  }

  Future<void>_fitAllPoints()async{
    final map=mapController;
    if(map==null)return;
    final points=<LatLng>[if(pickupPoint!=null)pickupPoint!,if(destinationPoint!=null)destinationPoint!,if(providerPoint!=null)providerPoint!];
    for(final line in routeLines)points.addAll(line.points);
    if(points.isEmpty)return;
    try{
      if(points.length==1){await map.animateCamera(CameraUpdate.newLatLngZoom(points.first,15));return;}
      var minLat=points.first.latitude,maxLat=points.first.latitude,minLng=points.first.longitude,maxLng=points.first.longitude;
      for(final p in points.skip(1)){minLat=min(minLat,p.latitude);maxLat=max(maxLat,p.latitude);minLng=min(minLng,p.longitude);maxLng=max(maxLng,p.longitude);}
      final latPad=(maxLat-minLat).abs()*0.10,lngPad=(maxLng-minLng).abs()*0.10;
      await map.animateCamera(CameraUpdate.newLatLngBounds(LatLngBounds(
        southwest:LatLng(minLat-latPad,minLng-lngPad),northeast:LatLng(maxLat+latPad,maxLng+lngPad)),90));
    }catch(_){}
  }

  void _followProvider(){
    final map=mapController;
    final point=providerPoint;
    if(!followCamera||point==null||map==null)return;
    movingCamera=true;
    map.animateCamera(CameraUpdate.newLatLng(point)).whenComplete(()=>Future.delayed(const Duration(milliseconds:500),(){if(mounted)movingCamera=false;}));
  }

  GoogleMapController? mapController;

  @override Widget build(BuildContext c){
    final center=providerPoint??pickupPoint??const LatLng(28.6139,77.2090);
    final markers=<Marker>{
      if(pickupPoint!=null)Marker(markerId:const MarkerId('pickup'),position:pickupPoint!,infoWindow:const InfoWindow(title:'Pickup')),
      if(destinationPoint!=null)Marker(markerId:const MarkerId('destination'),position:destinationPoint!,icon:BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),infoWindow:const InfoWindow(title:'Destination')),
      if(providerPoint!=null)Marker(markerId:const MarkerId('partner'),position:providerPoint!,icon:BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueGreen),infoWindow:InfoWindow(title:widget.isProvider?'You':'Gofixo Partner')),
    };
    final title=status=='ongoing'?'Trip in progress':status=='accepted'?'Partner is on the way':'Live trip';
    return Scaffold(
      appBar:AppBar(title:Text(widget.isProvider?'Trip map':title)),
      body:Stack(children:[
        GoogleMap(
          initialCameraPosition:CameraPosition(target:center,zoom:15),
          onMapCreated:(m){mapController=m;WidgetsBinding.instance.addPostFrameCallback((_)=>_fitAllPoints());},
          onCameraMoveStarted:(){if(!movingCamera)followCamera=false;},
          gestureRecognizers:<Factory<OneSequenceGestureRecognizer>>{
            Factory<OneSequenceGestureRecognizer>(()=>EagerGestureRecognizer()),
          },
          rotateGesturesEnabled:true,
          tiltGesturesEnabled:true,
          scrollGesturesEnabled:true,
          zoomGesturesEnabled:true,
          myLocationEnabled:widget.isProvider,
          myLocationButtonEnabled:true,
          markers:markers,
          polylines:routeLines,
          zoomControlsEnabled:false,
          compassEnabled:true,
        ),
        Positioned(left:14,right:14,top:14,child:Container(
          padding:const EdgeInsets.symmetric(horizontal:14,vertical:12),
          decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:14)]),
          child:Row(children:[
            Icon(status=='ongoing'?Icons.navigation_rounded:Icons.two_wheeler,color:gfGreen),
            const SizedBox(width:10),
            Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
              Text(widget.isProvider?'Trip map':title,style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
              Text(widget.isProvider?'GPS is updating live':(status=='accepted'?'Partner location is live':'Connecting to partner…'),style:const TextStyle(fontSize:11,color:gfMuted)),
            ])),
            IconButton(onPressed:(){setState(()=>followCamera=true);_fitAllPoints();},icon:const Icon(Icons.fit_screen,color:gfGreen)),
            if(!widget.isProvider)IconButton(onPressed:(){setState(()=>followCamera=true);_followProvider();},icon:const Icon(Icons.my_location,color:gfGreen)),
          ]),
        )),
        Positioned(left:14,right:14,bottom:18,child:Container(
          padding:const EdgeInsets.all(16),
          decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(20),boxShadow:const[BoxShadow(color:Color(0x22000000),blurRadius:18)]),
          child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
            Row(children:[
              Container(width:44,height:44,decoration:const BoxDecoration(shape:BoxShape.circle,color:Color(0xFFEFFFF5)),child:const Icon(Icons.navigation_rounded,color:gfGreen)),
              const SizedBox(width:12),
              Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[
                Text(status=='ongoing'?'Ride in progress':status=='accepted'?'Partner is arriving':'Live ride',style:const TextStyle(fontWeight:FontWeight.w900,color:gfNavy)),
                Text(status=='ongoing'?'Heading to destination':'Heading to pickup',style:const TextStyle(fontSize:11,color:gfMuted)),
              ])),
            ]),
            if(routeDistanceMeters!=null||routeEtaSeconds!=null) ...[
              const SizedBox(height:14),
              Row(children:[
                Expanded(child:_LiveMetric(icon:Icons.route_rounded,label:'Distance',value:gfFormatDistance(routeDistanceMeters))),
                const SizedBox(width:10),
                Expanded(child:_LiveMetric(icon:Icons.schedule_rounded,label:'Live ETA',value:gfFormatEta(routeEtaSeconds))),
              ]),
            ],
          ]),
        )),
      ]),
    );
  }
}
