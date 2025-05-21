
import * as React from 'react';

import { Separator } from '@/components/ui/separator';

import { Calendar, Home, Inbox, Search, Settings } from "lucide-react"

import {
    SidebarProvider, SidebarInset, SidebarTrigger,
    Sidebar,
    SidebarContent,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from "@/components/ui/sidebar"

//
// Sample conversations
// This is some sample data - it is compatible with the sidebar layout also
//

const items = [
  {
    title: "What should I have for dinner?",
    url: "#"
  },
  {
    title: "What is the best toaster?",
    url: "#"
  },
  {
    title: "What is fun today?",
    url: "#"
  },
  {
    title: "How long do batteries last?",
    url: "#"
  }
]

export function ChatSidebar() {
  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Application</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <a href={item.url}>
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  )
}


export function ChatPage() {
  return (
    <SidebarProvider>
      <ChatSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="min-h-[50vh] flex-1 rounded-xl bg-muted/50 flex items-center justify-center md:min-h-min">
            <span className="text-xl font-medium">Conversation goes here...</span>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
