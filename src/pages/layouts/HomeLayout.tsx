import { FooterView } from "@/components/layout/Footer";
import { Navigation } from "@/components/layout/Navigation";

export function HomeLayout(props: {
  showBg: boolean;
  children: React.ReactNode;
  searchSlot?: React.ReactNode;
}) {
  return (
    <FooterView>
      <Navigation bg={props.showBg} searchSlot={props.searchSlot} />
      {props.children}
    </FooterView>
  );
}
