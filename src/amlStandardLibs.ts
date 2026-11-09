// The AutomationML standard libraries a CAEX 3.0 file refers to, as the
// AutomationML Editor writes them into a new file: interface classes (Port, ...),
// base role classes (Resource, Structure, Group, ...) and base attribute types.
// Taken from Empty.aml in https://github.com/AutomationML/AMLEngine2.1
// (Samples/WikiSnippets/src), under this license:
//
// The MIT License (MIT)
//
// Copyright 2017 AutomationML e.V.
//
// Permission is hereby granted, free of charge, to any person obtaining a copy of this software and
// associated documentation files (the "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included in all copies or substantial
// portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
// LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
// WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
export const STANDARD_LIBRARIES = `  <InterfaceClassLib Name="AutomationMLInterfaceClassLib">
    <Description>Standard Automation Markup Language Interface Class Library</Description>
    <Version>2.2.5</Version>
    <InterfaceClass Name="AutomationMLBaseInterface">
      <InterfaceClass Name="Order" RefBaseClassPath="AutomationMLBaseInterface">
        <Attribute Name="Direction" AttributeDataType="xs:string" RefAttributeType="AutomationMLBaseAttributeTypeLib/Direction" />
      </InterfaceClass>
      <InterfaceClass Name="Port" RefBaseClassPath="AutomationMLBaseInterface">
        <Attribute Name="Direction" AttributeDataType="xs:string" RefAttributeType="AutomationMLBaseAttributeTypeLib/Direction">
          <Constraint Name="AllowedValues">
            <NominalScaledType>
              <RequiredValue>In</RequiredValue>
              <RequiredValue>Out</RequiredValue>
              <RequiredValue>InOut</RequiredValue>
            </NominalScaledType>
          </Constraint>
        </Attribute>
        <Attribute Name="Cardinality" RefAttributeType="AutomationMLBaseAttributeTypeLib/Cardinality">
          <Attribute Name="MinOccur" AttributeDataType="xs:unsignedInt" />
          <Attribute Name="MaxOccur" AttributeDataType="xs:unsignedInt" />
        </Attribute>
        <Attribute Name="Category" AttributeDataType="xs:string" RefAttributeType="AutomationMLBaseAttributeTypeLib/Category" />
      </InterfaceClass>
      <InterfaceClass Name="PPRConnector" RefBaseClassPath="AutomationMLBaseInterface" />
      <InterfaceClass Name="ExternalDataConnector" RefBaseClassPath="AutomationMLBaseInterface">
        <Attribute Name="refURI" AttributeDataType="xs:anyURI" RefAttributeType="AutomationMLBaseAttributeTypeLib/refURI" />
        <InterfaceClass Name="COLLADAInterface" RefBaseClassPath="ExternalDataConnector" />
        <InterfaceClass Name="PLCopenXMLInterface" RefBaseClassPath="ExternalDataConnector" />
        <InterfaceClass Name="ExternalDataReference" RefBaseClassPath="ExternalDataConnector">
          <Attribute Name="MIMEType" AttributeDataType="xs:string" RefAttributeType="AutomationMLBaseAttributeTypeLib/MIMEType" />
        </InterfaceClass>
      </InterfaceClass>
      <InterfaceClass Name="Communication" RefBaseClassPath="AutomationMLBaseInterface">
        <InterfaceClass Name="SignalInterface" RefBaseClassPath="Communication" />
      </InterfaceClass>
    </InterfaceClass>
  </InterfaceClassLib>
  <RoleClassLib Name="AutomationMLBaseRoleClassLib">
    <Description>Automation Markup Language base role class library</Description>
    <Version>2.2.5</Version>
    <RoleClass Name="AutomationMLBaseRole">
      <RoleClass Name="Group" RefBaseClassPath="AutomationMLBaseRole">
        <Attribute Name="AssociatedFacet" AttributeDataType="xs:string" RefAttributeType="AutomationMLBaseAttributeTypeLib/AssociatedFacet" />
      </RoleClass>
      <RoleClass Name="Facet" RefBaseClassPath="AutomationMLBaseRole" />
      <RoleClass Name="Resource" RefBaseClassPath="AutomationMLBaseRole" />
      <RoleClass Name="Product" RefBaseClassPath="AutomationMLBaseRole" />
      <RoleClass Name="Process" RefBaseClassPath="AutomationMLBaseRole" />
      <RoleClass Name="Structure" RefBaseClassPath="AutomationMLBaseRole">
        <RoleClass Name="ProductStructure" RefBaseClassPath="Structure" />
        <RoleClass Name="ProcessStructure" RefBaseClassPath="Structure" />
        <RoleClass Name="ResourceStructure" RefBaseClassPath="Structure" />
      </RoleClass>
      <RoleClass Name="ExternalData" RefBaseClassPath="AutomationMLBaseRole" />
    </RoleClass>
  </RoleClassLib>
  <AttributeTypeLib Name="AutomationMLBaseAttributeTypeLib">
    <Description>Standard Automation Markup Language Attribute Type Library</Description>
    <Version>1.0</Version>
    <AttributeType Name="Direction" AttributeDataType="xs:string">
      <Constraint Name="AllowedValues">
        <NominalScaledType>
          <RequiredValue>In</RequiredValue>
          <RequiredValue>Out</RequiredValue>
          <RequiredValue>InOut</RequiredValue>
        </NominalScaledType>
      </Constraint>
    </AttributeType>
    <AttributeType Name="Cardinality">
      <Attribute Name="MinOccur" AttributeDataType="xs:unsignedInt" />
      <Attribute Name="MaxOccur" AttributeDataType="xs:unsignedInt" />
    </AttributeType>
    <AttributeType Name="Category" AttributeDataType="xs:string" />
    <AttributeType Name="refURI" AttributeDataType="xs:anyURI" />
    <AttributeType Name="AssociatedFacet" AttributeDataType="xs:string" />
    <AttributeType Name="ListType" />
    <AttributeType Name="OrderedListType" />
    <AttributeType Name="LocalizedAttribute" AttributeDataType="xs:string" />
    <AttributeType Name="AssociatedValue" />
    <AttributeType Name="MIMEType" AttributeDataType="xs:string" />
    <AttributeType Name="DocLang" AttributeDataType="xs:string" />
  </AttributeTypeLib>
`;
